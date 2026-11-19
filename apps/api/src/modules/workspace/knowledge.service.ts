import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { json, runCommand, validateActor } from './command-runner';
import { knowledgeActivities, knowledgeBatch, knowledgeCommit, knowledgeKinds } from './knowledge-policy';
const provider = 'crm-knowledge';
const ordered = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(ordered)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, ordered(x)]),
        )
      : v;
const hash = (v: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(ordered(v)))
    .digest('hex');
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  private admin(a: Actor) {
    if (!a.roles.includes('super_admin'))
      throw new ForbiddenException('当前知识资料含内部报价和客户证据，仅管理员可查阅维护');
  }
  schema() {
    return {
      id: 'business.knowledge.import',
      version: '1.0',
      permission: 'super_admin',
      agentWritesEnabled: false,
      effect: 'evidence-knowledge-import',
      activitiesCapability: {
        id: 'business.knowledge.activities',
        version: '1.0',
        permission: 'super_admin',
        effect: 'local-followup-and-action-write',
        agentWritesEnabled: false,
        sourceRequired: true,
        customerBindingRequired: true,
      },
      outputSchemas: {
        preview: { previewId: 'uuid', digest: 'sha256', entries: 'integer', expiresInSeconds: 'integer' },
        commit: { items: 'array of key,id,version,unchanged' },
        activities: { items: 'array of key,version,digest,followupId,actionId,reused' },
      },
      inputSchema: {
        preview: knowledgeBatch.toJSONSchema(),
        commit: knowledgeCommit.toJSONSchema(),
        activities: knowledgeActivities.toJSONSchema(),
      },
      guards: [
        'current session and role',
        'same-company customer scope',
        'preview digest and 30-minute expiry',
        'optimistic entry version',
        'serializable idempotency and audit',
      ],
      externalEffects: false,
      financialEffects: false,
    };
  }
  async list(a: Actor, q: Record<string, unknown>) {
    this.admin(a);
    const page = Number(q.page ?? 1),
      pageSize = Number(q.pageSize ?? 20),
      kind = String(q.kind ?? ''),
      search = String(q.search ?? ''),
      sort = String(q.sort ?? 'updatedAt'),
      order = String(q.order ?? 'desc');
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100000 ||
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      search.length > 200 ||
      !['updatedAt', 'title'].includes(sort) ||
      !['asc', 'desc'].includes(order) ||
      (kind && !knowledgeKinds.includes(kind as (typeof knowledgeKinds)[number]))
    )
      throw new BadRequestException('查询参数无效');
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const where = {
          tenantId: a.tenantId,
          ...(kind ? { kind } : {}),
          ...(search ? { OR: [{ title: { contains: search } }, { summary: { contains: search } }] } : {}),
        };
        const total = await tx.knowledgeEntry.count({ where });
        const items = await tx.knowledgeEntry.findMany({
          where,
          orderBy: [{ [sort]: order }, { id: order }] as Prisma.KnowledgeEntryOrderByWithRelationInput[],
          skip: (page - 1) * pageSize,
          take: pageSize,
        });
        return { items, total, page, pageSize };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async preview(a: Actor, input: Record<string, unknown>) {
    this.admin(a);
    const parsed = knowledgeBatch.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '导入格式无效');
    const b = parsed.data;
    return runCommand(this.prisma, a, 'business.knowledge.preview@1.0', b, async (tx) => {
      const scope = await this.workspace.scope(tx, a, 'customers');
      for (const e of b.entries) {
        if (
          e.customerId &&
          !(await tx.customer.findFirst({ where: { AND: [scope, { id: e.customerId }] }, select: { id: true } }))
        )
          throw new NotFoundException('关联客户不存在或无权访问');
        const old = await tx.knowledgeEntry.findUnique({
          where: { tenantId_sourceKey: { tenantId: a.tenantId, sourceKey: e.key } },
        });
        if ((old?.version ?? 0) !== e.expectedVersion) throw new ConflictException('资料版本已变化，请刷新预演');
      }
      const id = randomUUID(),
        digest = hash(b.entries);
      await tx.integrationRun.create({
        data: {
          id,
          tenantId: a.tenantId,
          provider,
          kind: 'preview',
          status: 'ready',
          actorId: a.userId,
          bindingHash: hash(a.sessionId),
          snapshot: json(b.entries),
          summary: { digest },
        },
      });
      return {
        previewId: id,
        digest,
        entries: b.entries.length,
        expiresInSeconds: 1800,
        externalEffects: false,
        financialEffects: false,
      };
    });
  }
  async activities(a: Actor, input: Record<string, unknown>) {
    this.admin(a);
    const parsed = knowledgeActivities.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '活动参数无效');
    const b = parsed.data;
    return runCommand(this.prisma, a, 'business.knowledge.activities@1.0', b, async (tx) => {
      const items = [];
      for (const x of b.items) {
        const row = await tx.knowledgeEntry.findUnique({
          where: { tenantId_sourceKey: { tenantId: a.tenantId, sourceKey: x.key } },
        });
        if (!row || !row.customerId || !['project', 'meeting', 'outsourcing'].includes(row.kind))
          throw new NotFoundException('客户证据不存在');
        if (row.version !== x.expectedVersion) throw new ConflictException('证据版本已变化');
        const kind =
          x.targetType === 'customer' ? 'customers' : x.targetType === 'opportunity' ? 'opportunities' : 'leads';
        const target = await this.workspace.require(tx, a, kind, x.targetId);
        const targetCustomer =
          x.targetType === 'customer'
            ? target.id
            : x.targetType === 'opportunity'
              ? target.customerId
              : (target.aiEnrichment as Record<string, unknown> | null)?.salesIntake;
        const linkedCustomer =
          x.targetType === 'lead' && targetCustomer && typeof targetCustomer === 'object'
            ? (targetCustomer as Record<string, unknown>).customerId
            : targetCustomer;
        if (linkedCustomer !== row.customerId) throw new ConflictException('活动对象与证据客户不一致');
        const links = row.activityLinks as Record<string, unknown> | null;
        const digest = hash(x);
        if (links) {
          if (links.digest !== digest) throw new ConflictException('此证据已生成活动；更正请使用新证据版本另行审阅');
          items.push({ ...links, reused: true });
          continue;
        }
        if (x.amountPending) {
          if (
            x.targetType !== 'opportunity' ||
            target.status === 'won' ||
            target.updatedAt?.toISOString() !== x.targetVersion
          )
            throw new ConflictException('仅可将当前版本的未成交商机金额标为待核');
          const factors =
            target.healthFactors && typeof target.healthFactors === 'object'
              ? (target.healthFactors as Record<string, unknown>)
              : {};
          const meta =
            factors.salesIntake && typeof factors.salesIntake === 'object'
              ? (factors.salesIntake as Record<string, unknown>)
              : {};
          await tx.opportunity.update({
            where: { id: x.targetId },
            data: {
              healthFactors: json({
                ...factors,
                salesIntake: {
                  ...meta,
                  amountKnown: false,
                  forecastEligible: false,
                  amountBasis: '证据冲突待核：' + row.summary.slice(0, 1000),
                  pendingEvidence: row.sourceKey,
                },
              }),
            },
          });
        }
        const customer = await tx.customer.findFirst({
          where: { tenantId: a.tenantId, id: row.customerId, deletedAt: null },
        });
        const ownerId =
          x.targetType === 'opportunity'
            ? target.ownerId
            : x.targetType === 'lead'
              ? target.assigneeId
              : customer?.ownerId;
        if (
          !ownerId ||
          !(await tx.user.findFirst({
            where: { id: Number(ownerId), tenantId: a.tenantId, status: 'active', deletedAt: null },
          }))
        )
          throw new ConflictException('客户负责人需先确认');
        const action = x.action
          ? await tx.actionPlan.create({
              data: {
                tenantId: a.tenantId,
                targetType: 'customer',
                targetId: row.customerId,
                title: x.action.title,
                content: x.action.content + '\n[证据] ' + row.sourceKey + '；拟定行动，完成后以实际反馈确认。',
                actionType: 'evidence_plan',
                assigneeId: Number(ownerId),
                priority: x.action.priority,
                dueDate: new Date(x.action.dueDate),
                source: 'ai_recommend',
                status: 'pending',
                createdBy: a.userId,
              },
            })
          : null;
        const f = x.followup
          ? await tx.followUp.create({
              data: {
                tenantId: a.tenantId,
                targetType: x.targetType,
                targetId: x.targetId,
                customerId: row.customerId,
                method: 'other',
                content: x.followup.content,
                result: '历史证据整理',
                nextAction: x.action?.title,
                nextFollowAt: x.action ? new Date(x.action.dueDate) : null,
                createdBy: a.userId,
                aiStructured: json({
                  knowledge: {
                    key: row.sourceKey,
                    version: row.version,
                    sourceIds: row.sources,
                    occurredAt: x.followup.occurredAt,
                    activityType: 'evidence_review',
                    note: '证据整理时间与业务发生时间分开；不代表今天新增联系',
                  },
                }),
              },
            })
          : null;
        if (f && x.targetType === 'opportunity')
          await tx.opportunity.update({
            where: { id: x.targetId },
            data: {
              followCount: { increment: 1 },
              ...(x.followup?.occurredAt &&
              (!target.lastFollowAt || new Date(x.followup.occurredAt) > new Date(String(target.lastFollowAt)))
                ? { lastFollowAt: new Date(x.followup.occurredAt) }
                : {}),
              ...(x.action ? { nextAction: x.action.title, nextActionDate: new Date(x.action.dueDate) } : {}),
            },
          });
        if (f && x.targetType === 'lead')
          await tx.lead.update({
            where: { id: x.targetId },
            data: {
              followCount: { increment: 1 },
              ...(x.followup?.occurredAt &&
              (!target.lastFollowAt || new Date(x.followup.occurredAt) > new Date(String(target.lastFollowAt)))
                ? { lastFollowAt: new Date(x.followup.occurredAt) }
                : {}),
            },
          });
        const result = {
          key: x.key,
          version: row.version,
          digest,
          followupId: f?.id ?? null,
          actionId: action?.id ?? null,
        };
        await tx.knowledgeEntry.update({ where: { id: row.id }, data: { activityLinks: json(result) } });
        items.push({ ...result, reused: false });
      }
      return { items, externalEffects: false, financialEffects: false };
    });
  }
  async commit(a: Actor, input: Record<string, unknown>) {
    this.admin(a);
    const p = knowledgeCommit.safeParse(input);
    if (!p.success) throw new BadRequestException('提交参数无效');
    const b = p.data;
    return runCommand(this.prisma, a, 'business.knowledge.commit@1.0', b, async (tx) => {
      const run = await tx.integrationRun.findFirst({
        where: {
          id: b.previewId,
          tenantId: a.tenantId,
          provider,
          actorId: a.userId,
          bindingHash: hash(a.sessionId),
          status: 'ready',
          createdAt: { gte: new Date(Date.now() - 1800000) },
        },
      });
      if (!run || hash(run.snapshot) !== b.digest) throw new ConflictException('预演已过期、已执行或内容不符');
      const entries = knowledgeBatch.safeParse({ requestKey: b.requestKey, entries: run.snapshot });
      if (!entries.success) throw new ConflictException('预演内容无效');
      const scope = await this.workspace.scope(tx, a, 'customers'),
        items = [];
      for (const e of entries.data.entries) {
        if (
          e.customerId &&
          !(await tx.customer.findFirst({ where: { AND: [scope, { id: e.customerId }] }, select: { id: true } }))
        )
          throw new NotFoundException('关联客户已变化');
        const where = { tenantId_sourceKey: { tenantId: a.tenantId, sourceKey: e.key } },
          old = await tx.knowledgeEntry.findUnique({ where });
        if ((old?.version ?? 0) !== e.expectedVersion) throw new ConflictException('资料并发更新，整批取消');
        const key = e.key;
        const content = { ...e, expectedVersion: undefined };
        const contentHash = hash(content);
        let row = old;
        if (!old)
          row = await tx.knowledgeEntry.create({
            data: {
              tenantId: a.tenantId,
              sourceKey: key,
              kind: e.kind,
              title: e.title,
              customerId: e.customerId,
              summary: e.summary,
              evidenceStatus: e.evidenceStatus,
              sources: json(e.sources),
              content: json(e.content),
              contentHash,
              createdBy: a.userId,
              updatedBy: a.userId,
            },
          });
        else if (old.contentHash !== contentHash)
          row = await tx.knowledgeEntry.update({
            where,
            data: {
              kind: e.kind,
              title: e.title,
              customerId: e.customerId,
              summary: e.summary,
              evidenceStatus: e.evidenceStatus,
              sources: json(e.sources),
              content: json(e.content),
              contentHash,
              version: { increment: 1 },
              updatedBy: a.userId,
            },
          });
        items.push({ key, id: row!.id, version: row!.version, unchanged: old?.contentHash === contentHash });
      }
      await tx.integrationRun.update({ where: { id: run.id }, data: { status: 'committed' } });
      return { items, externalEffects: false, financialEffects: false };
    });
  }
}
