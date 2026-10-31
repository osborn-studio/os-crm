import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { admin, manager } from './access';
import { runCommand, object, text, id, checkVersion, json, type Tx } from './command-runner';
import { csvRecords, customerNames, nameKey, type ImportData } from './customer-policy';
import { Prisma, type Contract } from '@prisma/client';
import { WorkspaceService } from './workspace.service';
import { ApprovalService } from '../approval/approval.service';
import { allowWrite, hasPermission } from './access';
import { changePatch, changeEligible, contractSnapshot } from './contract-change-policy';

type PreviewRow = { row: number; data: ImportData; error: string; status: 'ready' | 'duplicate' | 'error' };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function keys(body: Record<string, unknown>, allowed: string[]) {
  object(body);
  if (Object.keys(body).some((k) => !allowed.includes(k))) throw new BadRequestException('存在未定义参数');
}
@Injectable()
export class CommercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
    private readonly approval: ApprovalService,
  ) {}
  async stages(a: Actor) {
    if (!hasPermission(a, 'opportunity:read')) throw new ForbiddenException('无商机读取权限');
    return this.prisma.system.opportunityStage.findMany({
      where: { tenantId: a.tenantId, isActive: true },
      select: { code: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });
  }
  private async contract(tx: Tx, a: Actor, contractId: number): Promise<Contract> {
    const c = await tx.contract.findFirst({
      where: { ...(await this.workspace.scope(tx, a, 'contracts')), id: contractId },
    });
    if (!c) throw new NotFoundException('合同不存在或无权访问');
    return c;
  }
  private async contractPlan(tx: Tx, a: Actor, contractId: number, body: Record<string, unknown>) {
    allowWrite(a);
    if (!hasPermission(a, 'contract:create')) throw new ForbiddenException('没有合同变更申请权限');
    const c = await this.contract(tx, a, contractId),
      type = text(body.changeType, '变更类型', 20),
      patch = changePatch(type, body.data);
    await changeEligible(tx, c);
    if (await tx.contractChange.count({ where: { tenantId: a.tenantId, contractId, status: 'pending' } }))
      throw new ConflictException('已有合同变更审批处理中');
    const before = contractSnapshot(c),
      proposed = { ...before, ...patch };
    if (proposed.startDate && proposed.endDate && proposed.startDate > proposed.endDate)
      throw new BadRequestException('合同开始日期不能晚于结束日期');
    if (Object.entries(patch).every(([k, v]) => String(before[k as keyof typeof before] ?? '') === String(v ?? '')))
      throw new BadRequestException('没有实际变更');
    const flow = await this.approval.matchFlow(tx, a, 'contract_change', new Prisma.Decimal(patch.amount ?? c.amount));
    const definition =
      flow.definition && typeof flow.definition === 'object' && !Array.isArray(flow.definition) ? flow.definition : {};
    return { c, type, patch, before, proposed, formFields: definition.fields ?? [], flowName: flow.name };
  }
  async previewChange(a: Actor, contractId: number, body: Record<string, unknown>) {
    keys(body, ['changeType', 'data']);
    const p = await this.contractPlan(this.prisma.system, a, contractId, body);
    return {
      contractId,
      expectedUpdatedAt: p.c.updatedAt,
      before: p.before,
      proposed: p.proposed,
      formFields: p.formFields,
      flowName: p.flowName,
      impact:
        p.type === 'terminate'
          ? '审批通过后终止合同、取消未执行回款计划并重算客户有效合同统计'
          : '审批通过后更新合同及单笔未执行回款计划，重算金额与客户统计',
    };
  }
  async requestChange(a: Actor, contractId: number, body: Record<string, unknown>) {
    keys(body, ['requestKey', 'expectedUpdatedAt', 'changeType', 'data', 'reason', 'form']);
    const reason = text(body.reason, '变更原因及凭据说明', 3000);
    return runCommand(this.prisma, a, 'contract.change.request', { ...body, contractId }, async (tx) => {
      const p = await this.contractPlan(tx, a, contractId, body);
      checkVersion(p.c, body.expectedUpdatedAt);
      const source = await tx.contract.update({
        where: { id: contractId },
        data: { updatedAt: new Date(Math.max(Date.now(), p.c.updatedAt.getTime() + 1)) },
      });
      const change = await tx.contractChange.create({
        data: {
          tenantId: a.tenantId,
          contractId,
          changeType: p.type as 'amount' | 'schedule' | 'terms' | 'terminate',
          beforeValue: JSON.stringify(contractSnapshot(source)),
          afterValue: JSON.stringify(object(body.data)),
          reason,
          requestedBy: a.userId,
        },
      });
      const approval = await this.approval.start(tx, a, {
        bizType: 'contract_change',
        bizId: change.id,
        bizNo: p.c.contractNo,
        title: `${p.c.name}·${p.type === 'terminate' ? '终止' : '变更'}`,
        amount: new Prisma.Decimal(p.patch.amount ?? p.c.amount),
        form: object(body.form ?? {}),
        businessSnapshot: {
          contractName: p.c.name,
          changeType: p.type,
          before: contractSnapshot(source),
          proposed: p.proposed,
          reason,
        },
      });
      await tx.contractChange.update({ where: { id: change.id }, data: { approvalId: approval.id } });
      return { id: change.id, contractId, approvalId: approval.id, status: 'pending' };
    });
  }
  private operator(a: Actor, importOnly = false) {
    if (!hasPermission(a, importOnly ? 'customer:create' : 'customer:update'))
      throw new ForbiddenException('当前权限不允许此客户操作');
    if (!admin(a) && (importOnly || !manager(a)))
      throw new ForbiddenException(importOnly ? '仅管理员可批量导入' : '仅管理员或销售主管可交接');
  }
  async options(a: Actor, keyword = '') {
    this.operator(a);
    if (!admin(a) && a.deptId === null) throw new ForbiddenException('主管需先分配到部门');
    const members = await this.prisma.system.user.findMany({
      where: { tenantId: a.tenantId, ...(!admin(a) ? { deptId: a.deptId } : {}) },
      select: { id: true, name: true, status: true },
    });
    const customers = await this.prisma.system.customer.findMany({
      where: {
        tenantId: a.tenantId,
        deletedAt: null,
        ...(!admin(a) ? { OR: [{ poolType: 'public' as const }, { ownerId: { in: members.map((m) => m.id) } }] } : {}),
        ...(keyword ? { name: { contains: keyword.slice(0, 100) } } : {}),
      },
      select: { id: true, name: true, ownerId: true, poolType: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const recipients = await this.prisma.system.user.findMany({
      where: {
        tenantId: a.tenantId,
        status: 'active',
        deletedAt: null,
        ...(!admin(a) ? { deptId: a.deptId } : {}),
        roles: { some: { tenantId: a.tenantId, role: { code: 'sales' } } },
      },
      select: { id: true, name: true },
      take: 100,
    });
    return {
      customers: customers.map((c) => ({
        ...c,
        ownerName: members.find((m) => m.id === c.ownerId)?.name ?? '公海或历史负责人',
      })),
      recipients,
    };
  }
  async changes(a: Actor, contractId: number) {
    await this.contract(this.prisma.system, a, contractId);
    const rows = await this.prisma.system.contractChange.findMany({
      where: { tenantId: a.tenantId, contractId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const users = await this.prisma.system.user.findMany({
      where: {
        tenantId: a.tenantId,
        id: { in: rows.flatMap((r) => [r.requestedBy, ...(r.approvedBy ? [r.approvedBy] : [])]) },
      },
      select: { id: true, name: true },
    });
    return rows.map((r) => {
      let before: Record<string, unknown>, after: Record<string, unknown>;
      try {
        before = object(JSON.parse(r.beforeValue));
        after = { ...before, ...changePatch(r.changeType, JSON.parse(r.afterValue)) };
      } catch {
        before = { 历史值: r.beforeValue };
        after = { 历史值: r.afterValue };
      }
      return {
        id: r.id,
        changeType: r.changeType,
        status: r.status,
        reason: r.reason,
        before,
        after,
        requestedBy: users.find((u) => u.id === r.requestedBy)?.name ?? '历史人员',
        approvedBy: users.find((u) => u.id === r.approvedBy)?.name ?? null,
        createdAt: r.createdAt,
        approvalId: r.approvalId,
      };
    });
  }
  async previewImport(a: Actor, body: Record<string, unknown>) {
    this.operator(a, true);
    keys(body, ['requestKey', 'csv']);
    if (typeof body.csv !== 'string') throw new BadRequestException('需要UTF-8 CSV文本');
    const csv = body.csv,
      parsed = csvRecords(csv);
    return runCommand(this.prisma, a, 'customer.import.preview', body, async (tx) => {
      const known = new Set((await customerNames(tx, a.tenantId)).map((r) => r.key));
      const rows: PreviewRow[] = parsed.map((r) => {
        const key = nameKey(r.data.name ?? '');
        const status = r.error ? 'error' : known.has(key) ? 'duplicate' : 'ready';
        if (status === 'ready') known.add(key);
        return { ...r, status };
      });
      const previewId = randomUUID(),
        hash = digest(rows),
        expiresAt = new Date(Date.now() + 15 * 60000);
      await tx.customerImport.create({
        data: {
          id: previewId,
          tenantId: a.tenantId,
          actorId: a.userId,
          sourceHash: createHash('sha256').update(csv).digest('hex'),
          digest: hash,
          preview: json(rows),
          expiresAt,
        },
      });
      return {
        previewId,
        digest: hash,
        expiresAt,
        rows,
        ready: rows.filter((r) => r.status === 'ready').length,
        duplicates: rows.filter((r) => r.status === 'duplicate').length,
        errors: rows.filter((r) => r.status === 'error').length,
      };
    });
  }
  async commitImport(a: Actor, body: Record<string, unknown>) {
    this.operator(a, true);
    keys(body, ['requestKey', 'previewId', 'digest']);
    return runCommand(this.prisma, a, 'customer.import.commit', body, async (tx) => {
      await tx.tenant.update({ where: { id: a.tenantId }, data: { updatedAt: new Date() } });
      const preview = await tx.customerImport.findFirst({
        where: { id: text(body.previewId, '预检编号', 36), tenantId: a.tenantId, actorId: a.userId },
      });
      if (!preview) throw new NotFoundException('预检不存在');
      if (preview.status !== 'preview' || preview.expiresAt <= new Date() || preview.digest !== body.digest)
        throw new ConflictException('预检已过期、提交或内容变化，请重新预检');
      const rows = preview.preview as unknown as PreviewRow[];
      if (!Array.isArray(rows) || rows.some((r) => r.status === 'error'))
        throw new BadRequestException('先修正所有错误记录再提交');
      const ready = rows.filter((r) => r.status === 'ready');
      if (!ready.length) throw new BadRequestException('没有可导入记录');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: a.tenantId } });
      if (
        (await tx.customer.count({ where: { tenantId: a.tenantId, deletedAt: null } })) + ready.length >
        tenant.maxCustomers
      )
        throw new ConflictException('企业客户额度不足');
      const known = new Set((await customerNames(tx, a.tenantId)).map((r) => r.key));
      if (ready.some((r) => known.has(nameKey(r.data.name))))
        throw new ConflictException('预检后已有同名客户创建，本次未写入任何客户，请重新预检');
      const ids: number[] = [];
      for (const r of ready) {
        const c = await tx.customer.create({
          data: {
            ...r.data,
            nameFingerprint: nameKey(r.data.name),
            tenantId: a.tenantId,
            code: 'KH' + randomUUID().replaceAll('-', '').slice(0, 16),
            poolType: 'public',
            createdBy: a.userId,
          },
        });
        ids.push(c.id);
      }
      await tx.customerImport.update({ where: { id: preview.id }, data: { status: 'committed' } });
      return {
        previewId: preview.id,
        imported: ids.length,
        skippedDuplicates: rows.filter((r) => r.status === 'duplicate').length,
        customerIds: ids,
        poolType: 'public',
        sourceHash: preview.sourceHash,
      };
    });
  }
  private async handoverPlan(tx: Tx, a: Actor, customerId: number, targetId: number) {
    this.operator(a);
    const members = await tx.user.findMany({
      where: { tenantId: a.tenantId, ...(!admin(a) ? { deptId: a.deptId } : {}) },
      select: { id: true },
    });
    if (!admin(a) && a.deptId === null) throw new ForbiddenException('主管需先分配到部门');
    const memberIds = members.map((m) => m.id);
    const customer = await tx.customer.findFirst({
      where: {
        id: customerId,
        tenantId: a.tenantId,
        deletedAt: null,
        ...(!admin(a) ? { OR: [{ poolType: 'public' as const }, { ownerId: { in: memberIds } }] } : {}),
      },
    });
    if (!customer) throw new NotFoundException('客户不存在或不在交接范围');
    const target = await tx.user.findFirst({
      where: {
        id: targetId,
        tenantId: a.tenantId,
        status: 'active',
        deletedAt: null,
        ...(!admin(a) ? { deptId: a.deptId } : {}),
        roles: { some: { tenantId: a.tenantId, role: { code: 'sales' } } },
      },
    });
    if (
      !target ||
      (target.deptId !== null &&
        !(await tx.department.findFirst({
          where: { id: target.deptId, tenantId: a.tenantId, status: 1, deletedAt: null },
        })))
    )
      throw new BadRequestException('接收人需为可交接部门中的有效销售');
    const filter = { tenantId: a.tenantId, customerId, deletedAt: null };
    const [opportunities, contracts, orders, projects, leads] = await Promise.all([
      tx.opportunity.findMany({ where: filter, select: { id: true, ownerId: true, updatedAt: true } }),
      tx.contract.findMany({ where: filter, select: { id: true, ownerId: true, status: true, updatedAt: true } }),
      tx.order.findMany({ where: filter, select: { id: true, ownerId: true, status: true, updatedAt: true } }),
      tx.project.findMany({ where: filter, select: { id: true, salesOwnerId: true, status: true, updatedAt: true } }),
      tx.lead.findMany({
        where: { tenantId: a.tenantId, convertedCustomerId: customerId, deletedAt: null },
        select: { id: true, assigneeId: true, updatedAt: true },
      }),
    ]);
    const owners = [
      ...opportunities.map((r) => r.ownerId),
      ...contracts.map((r) => r.ownerId),
      ...orders.map((r) => r.ownerId),
      ...projects.map((r) => r.salesOwnerId),
      ...leads.map((r) => r.assigneeId),
    ].filter((v): v is number => v !== null);
    if (!admin(a) && owners.some((owner) => !memberIds.includes(owner)))
      throw new ForbiddenException('存在其他部门销售负责的关联业务，请管理员处理');
    if (
      contracts.some((r) => r.status === 'pending_approval') ||
      orders.some((r) => r.status === 'pending_approval') ||
      projects.some((r) => r.status === 'pending_approval') ||
      (await tx.contractChange.count({
        where: { tenantId: a.tenantId, contractId: { in: contracts.map((r) => r.id) }, status: 'pending' },
      }))
    )
      throw new ConflictException('关联业务审批处理中，请先完成或撤回审批再交接');
    const actions = customer.ownerId
      ? await tx.actionPlan.findMany({
          where: {
            tenantId: a.tenantId,
            targetType: 'customer',
            targetId: customerId,
            assigneeId: customer.ownerId,
            status: { in: ['pending', 'in_progress', 'overdue'] },
          },
          select: { id: true, updatedAt: true },
        })
      : [];
    const graphDigest = digest({
      customerVersion: customer.updatedAt.toISOString(),
      ownerId: customer.ownerId,
      poolType: customer.poolType,
      target: { id: target.id, deptId: target.deptId },
      graph: [opportunities, contracts, orders, projects, leads, actions].map((rows) =>
        rows.slice().sort((x, y) => x.id - y.id),
      ),
    });
    return {
      customer,
      target,
      graphDigest,
      counts: {
        opportunities: opportunities.length,
        contracts: contracts.length,
        orders: orders.length,
        projects: projects.length,
        leads: leads.length,
        actions: actions.length,
      },
    };
  }
  async previewHandover(a: Actor, customerId: number, body: Record<string, unknown>) {
    keys(body, ['userId']);
    const p = await this.handoverPlan(this.prisma.system, a, customerId, id(body.userId));
    return {
      customerId,
      expectedUpdatedAt: p.customer.updatedAt,
      digest: p.graphDigest,
      fromUserId: p.customer.ownerId,
      toUserId: p.target.id,
      toName: p.target.name,
      counts: p.counts,
      deliveryNotice: '交接销售归属；项目经理、项目任务、历史跟进创建人和审批申请人保持原记录',
    };
  }
  async handover(a: Actor, customerId: number, body: Record<string, unknown>) {
    this.operator(a);
    keys(body, ['requestKey', 'expectedUpdatedAt', 'digest', 'userId', 'reason']);
    const reason = text(body.reason, '交接原因', 1000);
    return runCommand(this.prisma, a, 'customer.sales.handover', { ...body, customerId }, async (tx) => {
      const p = await this.handoverPlan(tx, a, customerId, id(body.userId));
      checkVersion(p.customer, body.expectedUpdatedAt);
      if (body.digest !== p.graphDigest) throw new ConflictException('关联业务在预检后有变化，请重新预检交接范围');
      if (p.customer.ownerId === p.target.id) throw new BadRequestException('接收人已是负责人');
      const filter = { tenantId: a.tenantId, customerId, deletedAt: null };
      await tx.customer.update({
        where: { id: customerId },
        data: {
          poolType: 'private',
          ownerId: p.target.id,
          ownerDeptId: p.target.deptId,
          protectUntil: new Date(Date.now() + 30 * 86400000),
          updatedBy: a.userId,
          updatedAt: new Date(Math.max(Date.now(), p.customer.updatedAt.getTime() + 1)),
        },
      });
      await tx.opportunity.updateMany({ where: filter, data: { ownerId: p.target.id } });
      await tx.contract.updateMany({ where: filter, data: { ownerId: p.target.id } });
      await tx.order.updateMany({ where: filter, data: { ownerId: p.target.id } });
      await tx.project.updateMany({ where: filter, data: { salesOwnerId: p.target.id } });
      await tx.lead.updateMany({
        where: { tenantId: a.tenantId, convertedCustomerId: customerId, deletedAt: null },
        data: { assigneeId: p.target.id },
      });
      if (p.customer.ownerId)
        await tx.actionPlan.updateMany({
          where: {
            tenantId: a.tenantId,
            targetType: 'customer',
            targetId: customerId,
            assigneeId: p.customer.ownerId,
            status: { in: ['pending', 'in_progress', 'overdue'] },
          },
          data: { assigneeId: p.target.id },
        });
      await tx.privateHolding.deleteMany({ where: { tenantId: a.tenantId, customerId } });
      await tx.privateHolding.create({
        data: {
          tenantId: a.tenantId,
          customerId,
          userId: p.target.id,
          claimedAt: new Date(),
          protectUntil: new Date(Date.now() + 30 * 86400000),
        },
      });
      return { customerId, fromUserId: p.customer.ownerId, toUserId: p.target.id, counts: p.counts, reason };
    });
  }
}
