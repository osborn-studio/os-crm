import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { admin } from '../workspace/access';
import { checkVersion, id, json, object, runCommand, text, type Tx } from '../workspace/command-runner';
import { condition, flowInput, type FlowField } from './flow-rules';
import { applyContractChange } from '../workspace/contract-change-policy';

function canDecide(roles: { role: { code: string; permissions: Prisma.JsonValue } }[]): boolean {
  if (roles.some((r) => r.role.code === 'super_admin')) return true;
  const permissions = roles.flatMap((r) =>
    Array.isArray(r.role.permissions) ? r.role.permissions.filter((p): p is string => typeof p === 'string') : [],
  );
  return ['approval:approve', 'approval:reject'].every((required) =>
    permissions.some((p) => p === '*' || p === 'approval:*' || p === required),
  );
}
@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}
  async flows(a: Actor) {
    return this.prisma.system.approvalFlow.findMany({
      where: { tenantId: a.tenantId, ...(!admin(a) ? { isActive: true } : {}) },
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
      orderBy: [{ priority: 'desc' }, { version: 'desc' }],
    });
  }
  async people(a: Actor) {
    if (!admin(a)) throw new ForbiddenException('仅管理员可配置流程');
    const [users, roles] = await Promise.all([
      this.prisma.system.user.findMany({
        where: { tenantId: a.tenantId, status: 'active', deletedAt: null },
        select: {
          id: true,
          name: true,
          deptId: true,
          roles: { select: { role: { select: { code: true, permissions: true } } } },
        },
      }),
      this.prisma.system.role.findMany({
        where: { tenantId: a.tenantId },
        select: { id: true, code: true, name: true, permissions: true },
      }),
    ]);
    return {
      users: users.filter((u) => canDecide(u.roles)).map(({ id, name, deptId }) => ({ id, name, deptId })),
      roles: roles.filter((role) => canDecide([{ role }])).map(({ id, code, name }) => ({ id, code, name })),
    };
  }
  async saveFlow(a: Actor, body: Record<string, unknown>) {
    if (!admin(a)) throw new ForbiddenException('仅管理员可设计审批流');
    const input = flowInput(body);
    return runCommand(this.prisma, a, 'approval.flow.save', body, async (tx) => {
      const previous = await tx.approvalFlow.findFirst({
        where: { tenantId: a.tenantId, name: input.name },
        orderBy: { version: 'desc' },
      });
      // Published definitions are immutable; each save creates a new draft version.
      const flow = await tx.approvalFlow.create({
        data: {
          tenantId: a.tenantId,
          name: input.name,
          bizType: input.bizType,
          conditionExpr: input.condition,
          priority: input.priority,
          isActive: false,
          version: (previous?.version ?? 0) + 1,
          createdBy: a.userId,
          definition: json({ fields: input.fields }),
        },
      });
      for (const [index, node] of input.nodes.entries()) {
        await this.resolve(tx, a.tenantId, node.approverType, node.approverValue, a.userId, false);
        await tx.approvalFlowNode.create({
          data: {
            tenantId: a.tenantId,
            flowId: flow.id,
            nodeOrder: index + 1,
            nodeName: node.name,
            approverType: node.approverType,
            approverValue: node.approverValue,
            conditionExpr: node.condition,
            isRequired: true,
          },
        });
      }
      return flow;
    });
  }
  async publish(a: Actor, flowId: number, body: Record<string, unknown>) {
    if (!admin(a)) throw new ForbiddenException('仅管理员可发布审批流');
    return runCommand(this.prisma, a, 'approval.flow.publish', { ...body, flowId }, async (tx) => {
      const flow = await tx.approvalFlow.findFirst({
        where: { id: flowId, tenantId: a.tenantId },
        include: { nodes: true },
      });
      if (!flow) throw new NotFoundException('流程不存在');
      checkVersion(flow, body.expectedUpdatedAt);
      if (!flow.nodes.length) throw new BadRequestException('空流程不能发布');
      condition(flow.conditionExpr ?? 'always', 0);
      await tx.approvalFlow.updateMany({
        where: { tenantId: a.tenantId, name: flow.name, isActive: true },
        data: { isActive: false },
      });
      return tx.approvalFlow.update({ where: { id: flow.id }, data: { isActive: true } });
    });
  }
  async preview(a: Actor, flowId: number, body: Record<string, unknown>) {
    const flow = await this.prisma.system.approvalFlow.findFirst({
      where: { id: flowId, tenantId: a.tenantId, ...(!admin(a) ? { isActive: true } : {}) },
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
    });
    if (!flow) throw new NotFoundException('流程不存在');
    const amount = this.amount(body.amount);
    const matches = condition(flow.conditionExpr ?? 'always', amount);
    const nodes = [];
    for (const n of flow.nodes) {
      if (!condition(n.conditionExpr ?? 'always', amount)) continue;
      const approverId = await this.resolve(this.prisma.system, a.tenantId, n.approverType, n.approverValue, a.userId);
      nodes.push({ name: n.nodeName, approverId });
    }
    return { matches, nodes, version: flow.version };
  }
  private amount(value: unknown) {
    const v = String(value ?? '0');
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) throw new BadRequestException('金额无效');
    return new Prisma.Decimal(v);
  }
  async matchFlow(tx: Tx, a: Actor, bizType: string, amount: Prisma.Decimal, flowId?: number) {
    const flows = await tx.approvalFlow.findMany({
      where: { tenantId: a.tenantId, bizType, isActive: true, ...(flowId ? { id: flowId } : {}) },
      orderBy: [{ priority: 'desc' }, { id: 'desc' }],
      include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
    });
    const flow = flows.find((f) => condition(f.conditionExpr ?? 'always', amount));
    if (!flow) throw new BadRequestException('未配置匹配的审批流程，请管理员配置后再提交');
    return flow;
  }
  async start(
    tx: Tx,
    a: Actor,
    data: {
      bizType: string;
      bizId: number;
      bizNo?: string;
      title: string;
      amount: Prisma.Decimal;
      form?: Record<string, unknown>;
      flowId?: number;
      businessSnapshot?: Record<string, unknown>;
    },
  ) {
    if (
      await tx.approval.findFirst({
        where: { tenantId: a.tenantId, bizType: data.bizType, bizId: data.bizId, status: 'pending' },
      })
    )
      throw new ConflictException('已有审批处理中');
    const flow = await this.matchFlow(tx, a, data.bizType, data.amount, data.flowId);
    const fields = (flow.definition && typeof flow.definition === 'object' && !Array.isArray(flow.definition)
      ? flow.definition.fields
      : []) as unknown as FlowField[];
    const form = data.form ?? {};
    for (const f of Array.isArray(fields) ? fields : []) {
      const value = form[f.key];
      if (f.required && (value === undefined || value === '')) throw new BadRequestException(`请填写${f.label}`);
      if (value !== undefined && value !== '') {
        if (f.type === 'text') text(value, f.label, 1000);
        if (f.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
          throw new BadRequestException(`${f.label}必须为数字`);
        if (
          f.type === 'date' &&
          (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))
        )
          throw new BadRequestException(`${f.label}必须为有效日期`);
      }
    }
    const nodes = [];
    for (const n of flow.nodes) {
      if (!condition(n.conditionExpr ?? 'always', data.amount)) continue;
      const approverId = await this.resolve(tx, a.tenantId, n.approverType, n.approverValue, a.userId);
      if (approverId === a.userId) throw new BadRequestException(`节点“${n.nodeName}”不能由申请人审批，请调整流程`);
      nodes.push({ ...n, approverId });
    }
    if (!nodes.length) throw new BadRequestException('没有匹配的审批节点，不允许自动通过');
    const approval = await tx.approval.create({
      data: {
        tenantId: a.tenantId,
        approvalNo: `SP${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        bizType: data.bizType,
        bizId: data.bizId,
        bizNo: data.bizNo,
        title: data.title,
        applicantId: a.userId,
        formData: json({
          ...form,
          ...(data.businessSnapshot ? { businessSnapshot: data.businessSnapshot } : {}),
          amount: data.amount.toString(),
          flowSnapshot: {
            id: flow.id,
            name: flow.name,
            version: flow.version,
            fields,
            nodes: nodes.map((n) => ({ name: n.nodeName, approverId: n.approverId, order: n.nodeOrder })),
          },
        }),
      },
    });
    let firstId = 0;
    for (const n of nodes) {
      const created = await tx.approvalNode.create({
        data: {
          tenantId: a.tenantId,
          approvalId: approval.id,
          nodeOrder: n.nodeOrder,
          nodeName: n.nodeName,
          approverId: n.approverId,
        },
      });
      firstId ||= created.id;
    }
    await tx.notification.create({
      data: {
        tenantId: a.tenantId,
        userId: nodes[0].approverId,
        type: 'approval.created',
        title: data.title,
        content: '有新的审批等待处理',
        bizType: data.bizType,
        bizId: approval.id,
      },
    });
    return tx.approval.update({ where: { id: approval.id }, data: { currentNodeId: firstId } });
  }
  async create(a: Actor, body: Record<string, unknown>) {
    // Business objects are submitted through their own guarded command; this endpoint is general forms only.
    const flowId = id(body.flowId),
      form = object(body.form ?? {});
    return runCommand(this.prisma, a, 'approval.create', body, async (tx) => {
      const flow = await tx.approvalFlow.findFirst({ where: { id: flowId, tenantId: a.tenantId, isActive: true } });
      if (!flow || ['contract', 'contract_change', 'order', 'project_initiation'].includes(flow.bizType))
        throw new BadRequestException('请选择通用表单流程；业务单据请从详情页提交');
      return this.start(tx, a, {
        bizType: flow.bizType,
        bizId: -Math.floor(Date.now() % 2000000000),
        title: text(body.title, '申请标题'),
        amount: this.amount(body.amount),
        form,
        flowId,
      });
    });
  }
  async decide(
    a: Actor,
    approvalId: number,
    nodeId: number,
    action: 'approved' | 'rejected',
    body: Record<string, unknown>,
  ) {
    const comment =
      action === 'rejected' ? text(body.comment, '驳回原因', 1000) : String(body.comment ?? '同意').slice(0, 1000);
    return runCommand(this.prisma, a, `approval.${action}`, { ...body, approvalId, nodeId }, async (tx) => {
      const approval = await tx.approval.findFirst({
        where: { tenantId: a.tenantId, id: approvalId, status: 'pending', currentNodeId: nodeId },
      });
      const node = await tx.approvalNode.findFirst({
        where: { tenantId: a.tenantId, id: nodeId, approvalId, approverId: a.userId, action: 'pending' },
      });
      if (!approval || !node || approval.applicantId === a.userId)
        throw new ForbiddenException('不是当前节点审批人，或审批已处理');
      await tx.approvalNode.update({ where: { id: node.id }, data: { action, comment, actedAt: new Date() } });
      const next =
        action === 'approved'
          ? await tx.approvalNode.findFirst({
              where: { tenantId: a.tenantId, approvalId, action: 'pending', nodeOrder: { gt: node.nodeOrder } },
              orderBy: { nodeOrder: 'asc' },
            })
          : null;
      const status = next ? 'pending' : action;
      await tx.approval.update({
        where: { id: approvalId },
        data: { status, currentNodeId: next?.id ?? null, completedAt: next ? null : new Date() },
      });
      await tx.notification.create({
        data: {
          tenantId: a.tenantId,
          userId: next?.approverId ?? approval.applicantId,
          type: next ? 'approval.created' : 'approval.completed',
          title: approval.title,
          content: next ? '审批已流转至你' : action === 'approved' ? '申请已通过' : '申请已驳回',
          bizType: approval.bizType,
          bizId: approval.id,
        },
      });
      if (!next) await this.callback(tx, a.tenantId, approval.bizType, approval.bizId, approval.id, action, a.userId);
      return { id: approvalId, status, nextNode: next?.nodeName };
    });
  }
  async withdraw(a: Actor, approvalId: number, body: Record<string, unknown>) {
    return runCommand(this.prisma, a, 'approval.withdraw', { ...body, approvalId }, async (tx) => {
      const approval = await tx.approval.findFirst({
        where: { id: approvalId, tenantId: a.tenantId, applicantId: a.userId, status: 'pending' },
      });
      if (!approval) throw new BadRequestException('审批不存在或不可撤回');
      await tx.approval.update({
        where: { id: approvalId },
        data: { status: 'withdrawn', currentNodeId: null, completedAt: new Date() },
      });
      await this.callback(tx, a.tenantId, approval.bizType, approval.bizId, approval.id, 'draft');
      return { status: 'withdrawn' };
    });
  }
  async pending(a: Actor) {
    const nodes = await this.prisma.system.approvalNode.findMany({
      where: {
        tenantId: a.tenantId,
        approverId: a.userId,
        action: 'pending',
        approval: { tenantId: a.tenantId, status: 'pending' },
      },
      include: { approval: true },
      orderBy: { createdAt: 'asc' },
    });
    return nodes
      .filter((n) => n.approval.currentNodeId === n.id)
      .map((n) => ({ nodeId: n.id, nodeName: n.nodeName, approval: n.approval }));
  }
  async initiated(a: Actor) {
    return {
      items: await this.prisma.system.approval.findMany({
        where: { tenantId: a.tenantId, applicantId: a.userId },
        include: { nodes: { orderBy: { nodeOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    };
  }
  private async callback(
    tx: Tx,
    tenantId: number,
    type: string,
    bizId: number,
    approvalId: number,
    status: 'approved' | 'rejected' | 'draft',
    approverId?: number,
  ) {
    if (type === 'contract_change') await applyContractChange(tx, tenantId, bizId, approvalId, status, approverId);
    if (type === 'contract')
      await tx.contract.updateMany({
        where: { id: bizId, tenantId, approvalId, status: 'pending_approval' },
        data: { status },
      });
    if (type === 'order')
      await tx.order.updateMany({
        where: { id: bizId, tenantId, approvalId, status: 'pending_approval' },
        data: { status: status === 'rejected' ? 'draft' : status },
      });
    if (type === 'project_initiation')
      await tx.project.updateMany({
        where: { id: bizId, tenantId, approvalId, status: 'pending_approval' },
        data: { status: status === 'approved' ? 'active' : status },
      });
  }
  private async resolve(
    tx: Tx,
    tenantId: number,
    type: string,
    value: string | null,
    applicantId: number,
    requireLeader = true,
  ): Promise<number> {
    let userId: number | undefined;
    if (type === 'user') userId = Number(value);
    if (type === 'role') {
      const role = await tx.role.findFirst({ where: { tenantId, code: value ?? '' } });
      const links = role
        ? await tx.userRole.findMany({ where: { tenantId, roleId: role.id }, orderBy: { userId: 'asc' } })
        : [];
      const active = await tx.user.findMany({
        where: {
          tenantId,
          id: { in: links.map((l) => l.userId) },
          status: 'active',
          deletedAt: null,
          ...(requireLeader ? { NOT: { id: applicantId } } : {}),
        },
        include: { roles: { include: { role: true } } },
        orderBy: { id: 'asc' },
      });
      const candidates = active.filter((u) => canDecide(u.roles));
      if (candidates.length > 1) throw new BadRequestException('该角色存在多名可用审批人，请在设计器中指定审批人');
      userId = candidates[0]?.id;
    }
    if (type === 'dept_leader' || type === 'applicant_leader') {
      const u = await tx.user.findFirst({ where: { id: applicantId, tenantId } });
      const dept = u?.deptId ? await tx.department.findFirst({ where: { id: u.deptId, tenantId } }) : null;
      userId = dept?.leaderId ?? undefined;
      if (!requireLeader) return userId ?? applicantId;
    }
    const u = userId
      ? await tx.user.findFirst({
          where: { id: userId, tenantId, status: 'active', deletedAt: null },
          include: { roles: { include: { role: true } } },
        })
      : null;
    if (!u) throw new BadRequestException('找不到有效审批人，禁止跳过节点');
    if (!canDecide(u.roles)) throw new BadRequestException('所选人员没有完整的审批通过/驳回权限');
    return u.id;
  }
}
