import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ServiceTicket } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { WorkspaceService } from './workspace.service';
import { admin, allowWrite, hasPermission, ownerScope } from './access';
import { runCommand, checkVersion, text, id, json, type Tx } from './command-runner';
import { deliveryPeople } from './delivery-staff-policy';
import { ticketActions, ticketKeys, ticketTransition } from './service-ticket-policy';
@Injectable()
export class ServiceTicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  private write(a: Actor) {
    allowWrite(a);
    if (!hasPermission(a, 'project:update')) throw new ForbiddenException('没有售后处理权限');
  }
  private async scope(tx: Tx, a: Actor): Promise<Prisma.ServiceTicketWhereInput> {
    // Assignment alone grants only this ticket; it never broadens project/customer visibility.
    const projects = await tx.project.findMany({
      where: await this.workspace.scope(tx, a, 'projects'),
      select: { id: true },
    });
    return {
      tenantId: a.tenantId,
      OR: [{ projectId: { in: projects.map((p) => p.id) } }, { assigneeId: a.userId }, { createdBy: a.userId }],
    };
  }
  private async require(tx: Tx, a: Actor, ticketId: number) {
    const row = await tx.serviceTicket.findFirst({ where: { ...(await this.scope(tx, a)), id: ticketId } });
    if (!row) throw new NotFoundException('工单不存在或无权访问');
    return row;
  }
  async authorizeAttachment(tx: Tx, a: Actor, ticketId: number, write: boolean) {
    const row = await this.require(tx, a, ticketId);
    if (write) {
      this.write(a);
      if (!['open', 'assigned', 'in_progress'].includes(row.status))
        throw new ConflictException('待复核、关闭或取消工单的附件冻结');
      if (row.assigneeId !== a.userId) await this.manager(tx, a, row.projectId);
    }
    return row;
  }
  private async manager(tx: Tx, a: Actor, projectId: number) {
    const p = await tx.project.findFirst({
      where: {
        tenantId: a.tenantId,
        id: projectId,
        deletedAt: null,
        ...(!admin(a)
          ? {
              OR: [{ pmId: a.userId }, ...(a.roles.includes('sales_manager') ? [await ownerScope(tx, a, 'pmId')] : [])],
            }
          : {}),
      },
    });
    if (!p) throw new ForbiddenException('仅项目经理、其部门主管或管理员可管理工单');
    return p;
  }
  async list(a: Actor, cursor?: string) {
    const before = cursor === undefined ? undefined : id(Number(cursor));
    const rows = await this.prisma.system.serviceTicket.findMany({
      where: { ...(await this.scope(this.prisma.system, a)), ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: 51,
    });
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? String(rows[49].id) : null };
  }
  async detail(a: Actor, ticketId: number, cursor?: string) {
    const tx = this.prisma.system,
      row = await this.require(tx, a, ticketId);
    const before = cursor === undefined ? undefined : id(Number(cursor));
    const events = await tx.serviceTicketEvent.findMany({
      where: { tenantId: a.tenantId, ticketId, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: 51,
    });
    let canManage = false;
    if (!a.roles.includes('gm') && hasPermission(a, 'project:update')) {
      try {
        this.write(a);
        await this.manager(tx, a, row.projectId);
        canManage = true;
      } catch (e) {
        if (!(e instanceof ForbiddenException)) throw e;
      }
    }
    const allowedActions = ticketActions.filter((action) => {
      try {
        this.write(a);
        ticketTransition(row, action, a.userId);
        return ['assign', 'close', 'reopen', 'cancel'].includes(action) ? canManage : row.assigneeId === a.userId;
      } catch (e) {
        if (e instanceof ForbiddenException || e instanceof BadRequestException || e instanceof ConflictException)
          return false;
        throw e;
      }
    });
    return {
      ...row,
      allowedActions,
      events: events.slice(0, 50),
      nextEventCursor: events.length > 50 ? String(events[49].id) : null,
    };
  }
  async people(a: Actor, ticketId: number) {
    this.write(a);
    const tx = this.prisma.system,
      row = await this.require(tx, a, ticketId);
    return deliveryPeople(tx, a, await this.manager(tx, a, row.projectId));
  }
  private async event(tx: Tx, a: Actor, row: ServiceTicket, kind: string, note: string, evidence: unknown) {
    const actor = await tx.user.findFirstOrThrow({
      where: { tenantId: a.tenantId, id: a.userId },
      select: { name: true },
    });
    await tx.serviceTicketEvent.create({
      data: {
        tenantId: a.tenantId,
        ticketId: row.id,
        actorId: a.userId,
        actorName: actor.name,
        kind,
        note,
        evidence: json(evidence),
      },
    });
  }
  private async notify(tx: Tx, a: Actor, row: ServiceTicket, kind: string, candidates: number[]) {
    // Inbox metadata only; no customer/problem/solution text is copied to old recipients.
    const users = await tx.user.findMany({
      where: {
        tenantId: a.tenantId,
        id: { in: [...new Set(candidates)].filter((v) => v !== a.userId) },
        status: 'active',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (users.length)
      await tx.notification.createMany({
        data: users.map((u) => ({
          tenantId: a.tenantId,
          userId: u.id,
          type: 'service-ticket.' + kind,
          title: '售后工单 #' + row.id,
          content:
            (
              {
                created: '新工单待指派',
                assign: '工单已指派，请查看当前职责',
                resolve: '解决方案待另一管理人复核',
                close: '工单已复核关闭',
                reopen: '工单需要重新处理',
                cancel: '工单已取消',
              } as Record<string, string>
            )[kind] ?? '工单状态已更新',
          bizType: 'service-ticket',
          bizId: row.id,
          channel: 'inbox' as const,
        })),
      });
  }
  async create(a: Actor, body: Record<string, unknown>) {
    this.write(a);
    ticketKeys(body, ['requestKey', 'projectId', 'title', 'description', 'priority']);
    return runCommand(
      this.prisma,
      a,
      'service-ticket.create',
      body,
      async (tx) => {
        const p = await tx.project.findFirst({
          where: { ...(await this.workspace.scope(tx, a, 'projects')), id: id(body.projectId) },
        });
        if (!p || p.acceptanceState !== 'accepted' || p.status !== 'completed')
          throw new BadRequestException('售后工单需要已通过新版验收的完成项目');
        const priority = text(body.priority, '优先级', 10);
        if (!['low', 'medium', 'high'].includes(priority)) throw new BadRequestException('优先级无效');
        const row = await tx.serviceTicket.create({
          data: {
            tenantId: a.tenantId,
            projectId: p.id,
            customerId: p.customerId,
            title: text(body.title, '标题'),
            description: text(body.description, '问题描述', 5000),
            priority,
            createdBy: a.userId,
          },
        });
        await this.event(tx, a, row, 'created', row.description, {
          projectId: p.id,
          customerId: p.customerId,
          title: row.title,
          priority,
        });
        await this.notify(tx, a, row, 'created', [p.pmId]);
        return row;
      },
      async (tx) => {
        // Replaying a result must not reveal a ticket after the caller loses project visibility.
        const p = await tx.project.findFirst({
          where: { ...(await this.workspace.scope(tx, a, 'projects')), id: id(body.projectId) },
          select: { id: true },
        });
        if (!p) throw new NotFoundException('项目不存在或无权访问');
      },
    );
  }
  async command(a: Actor, ticketId: number, action: string, body: Record<string, unknown>) {
    this.write(a);
    ticketKeys(body, ['requestKey', 'expectedUpdatedAt', 'note', ...(action === 'assign' ? ['userId'] : [])]);
    return runCommand(
      this.prisma,
      a,
      `service-ticket.${ticketId}.${action}`,
      body,
      async (tx) => {
        const row = await this.require(tx, a, ticketId);
        checkVersion(row, body.expectedUpdatedAt);
        let status = ticketTransition(row, action, a.userId);
        const note = text(body.note, '处理说明', 5000);
        const management = ['assign', 'close', 'reopen', 'cancel'].includes(action);
        const p = management ? await this.manager(tx, a, row.projectId) : null;
        if (!management && row.assigneeId !== a.userId)
          throw new ForbiddenException('仅当前处理人可记录或提交解决方案');
        let assigneeId = row.assigneeId;
        if (action === 'assign') {
          const candidate = (await deliveryPeople(tx, a, p!)).find((u) => u.id === id(body.userId));
          if (!candidate || candidate.id === row.assigneeId) throw new BadRequestException('接收人无效或未变化');
          assigneeId = candidate.id;
        }
        // A closed ticket ignores staffing guards, so reopening must re-qualify the previous
        // assignee exactly as a fresh assignment would; otherwise it returns to the unassigned pool.
        if (action === 'reopen' && !(await deliveryPeople(tx, a, p!)).some((u) => u.id === assigneeId)) {
          assigneeId = null;
          status = 'open';
        }
        const updated = await tx.serviceTicket.update({
          where: { id: row.id, tenantId: a.tenantId },
          data: {
            status,
            assigneeId,
            ...(action === 'resolve' ? { resolvedBy: a.userId, resolution: note } : {}),
            ...(action === 'reopen' ? { resolvedBy: null, resolution: null } : {}),
            updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)),
          },
        });
        await this.event(tx, a, row, action, note, {
          before: { status: row.status, assigneeId: row.assigneeId },
          after: { status, assigneeId },
          ...(action === 'resolve'
            ? {
                attachments: await tx.evidenceAttachment.findMany({
                  where: { tenantId: a.tenantId, subjectKind: 'service-tickets', subjectId: row.id, withdrawnAt: null },
                  select: { id: true, filename: true, sha256: true, size: true },
                  orderBy: { id: 'asc' },
                }),
              }
            : {}),
          ...(action === 'reopen' ? { previousResolution: row.resolution, previousResolvedBy: row.resolvedBy } : {}),
        });
        if (['assign', 'reopen', 'close', 'cancel'].includes(action))
          await this.notify(tx, a, updated, action, [
            row.createdBy,
            ...(updated.assigneeId ? [updated.assigneeId] : []),
          ]);
        if (action === 'resolve') {
          const project = await tx.project.findFirstOrThrow({ where: { tenantId: a.tenantId, id: row.projectId } });
          const admins = await tx.user.findMany({
            where: {
              tenantId: a.tenantId,
              status: 'active',
              deletedAt: null,
              roles: { some: { role: { tenantId: a.tenantId, code: 'super_admin' } } },
            },
            select: { id: true },
          });
          await this.notify(tx, a, updated, action, [project.pmId, row.createdBy, ...admins.map((u) => u.id)]);
        }
        return updated;
      },
      async (tx) => {
        await this.require(tx, a, ticketId);
      },
    );
  }
}
