import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AgentGrant } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { admin, hasPermission } from '../workspace/access';
import { checkVersion, json, runCommand, text, type Tx } from '../workspace/command-runner';
import { WorkspaceService } from '../workspace/workspace.service';
import { CapabilityService } from './capability.service';
import { contextHash, digest, grantInput, invocation, only, tokenHash, uuid } from './agent-policy';
import { agentCatalog } from './agent.catalog';

const grantSelect = {
  id: true,
  tenantId: true,
  ownerId: true,
  name: true,
  purpose: true,
  capabilities: true,
  maxCalls: true,
  usedCalls: true,
  expiresAt: true,
  revokedAt: true,
  revokeReason: true,
  createdAt: true,
  updatedAt: true,
} as const;
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly workspace: WorkspaceService,
    private readonly capabilities: CapabilityService,
  ) {}
  private hash(token: string) {
    return tokenHash(token, this.config.getOrThrow<string>('app.jwt.secret'));
  }
  private async actor(tx: Tx, grant: AgentGrant): Promise<Actor> {
    const user = await tx.user.findFirst({
      where: {
        id: grant.ownerId,
        tenantId: grant.tenantId,
        deletedAt: null,
        status: 'active',
        tenant: { status: { in: ['active', 'trial'] } },
      },
      include: { roles: { include: { role: true } } },
    });
    const session = await tx.authSession.findFirst({
      where: {
        id: grant.ownerSessionId,
        tenantId: grant.tenantId,
        userId: grant.ownerId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!user || !session || grant.revokedAt || grant.expiresAt <= new Date())
      throw new UnauthorizedException('智能体委托已失效');
    const roles = user.roles.map((r) => r.role);
    const actor: Actor = {
      userId: user.id,
      tenantId: user.tenantId,
      sessionId: session.id,
      deptId: user.deptId,
      roles: roles.map((r) => r.code),
      permissions: [
        ...new Set(
          roles.flatMap((r) =>
            Array.isArray(r.permissions) ? r.permissions.filter((p): p is string => typeof p === 'string') : [],
          ),
        ),
      ],
      dataScope:
        (['all', 'dept', 'team', 'custom', 'self'] as const).find((s) => roles.some((r) => r.dataScope === s)) ??
        'self',
    };
    if (contextHash(actor) !== grant.contextHash) throw new UnauthorizedException('委托人的权限已变化，请重新授权');
    return actor;
  }
  private async context(tx: Tx, authorization?: string) {
    if (typeof authorization !== 'string' || !/^Bearer tbcrm_agent_[A-Za-z0-9_-]{43}$/.test(authorization))
      throw new UnauthorizedException('需要独立智能体委托凭证');
    const grant = await tx.agentGrant.findUnique({ where: { tokenHash: this.hash(authorization.slice(7)) } });
    if (!grant) throw new UnauthorizedException('智能体委托凭证无效');
    return { grant, actor: await this.actor(tx, grant) };
  }
  private async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.system.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(e.code) && attempt < 2)
          continue;
        throw e;
      }
    }
    throw new ConflictException('智能体操作冲突，请重试');
  }
  private scope(a: Actor) {
    return { tenantId: a.tenantId, ...(!admin(a) ? { ownerId: a.userId } : {}) };
  }
  schema(a: Actor) {
    return agentCatalog(a);
  }
  async runtimeCatalog(authorization?: string) {
    const { grant, actor } = await this.context(this.prisma.system, authorization);
    return {
      grantId: grant.id,
      name: grant.name,
      expiresAt: grant.expiresAt,
      remainingCalls: Math.max(0, grant.maxCalls - grant.usedCalls),
      capabilities: agentCatalog(actor).tools.filter((t) => (grant.capabilities as string[]).includes(t.id)),
    };
  }
  private async cursor(a: Actor, kind: 'grants' | 'proposals' | 'executions', after?: string) {
    if (after === undefined) return {};
    uuid(after);
    const args = { where: { ...this.scope(a), id: after }, select: { id: true, createdAt: true } as const };
    const row =
      kind === 'grants'
        ? await this.prisma.system.agentGrant.findFirst(args)
        : kind === 'proposals'
          ? await this.prisma.system.agentProposal.findFirst(args)
          : await this.prisma.system.agentExecution.findFirst(args);
    if (!row) throw new NotFoundException('分页游标不存在或不可见');
    return { OR: [{ createdAt: { lt: row.createdAt } }, { createdAt: row.createdAt, id: { lt: row.id } }] };
  }
  async list(a: Actor, after?: string) {
    const rows = await this.prisma.system.agentGrant.findMany({
      where: { ...this.scope(a), ...(await this.cursor(a, 'grants', after)) },
      select: grantSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
  }
  async issue(a: Actor, body: Record<string, unknown>) {
    const input = grantInput(body),
      grantId = randomUUID(),
      token = 'tbcrm_agent_' + randomBytes(32).toString('base64url');
    const allowed = this.capabilities.list(a).map((c) => c.id);
    if (
      hasPermission(a, 'action:create') &&
      hasPermission(a, 'customer:read') &&
      (admin(a) || a.roles.includes('sales_manager') || a.roles.includes('sales'))
    )
      allowed.push('action.propose', 'action.execute');
    if (input.capabilities.some((c) => !allowed.includes(c))) throw new ForbiddenException('不能委托本人没有的能力');
    const result = await runCommand(this.prisma, a, 'agent.grant.issue', body, async (tx) => {
      if (!a.sessionId) throw new ForbiddenException('需要有效人工会话');
      const session = await tx.authSession.findUniqueOrThrow({ where: { id: a.sessionId } });
      const expiresAt = new Date(Math.min(Date.now() + input.minutes * 60000, session.expiresAt.getTime()));
      if (
        (await tx.agentGrant.count({
          where: { tenantId: a.tenantId, ownerId: a.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        })) >= 10
      )
        throw new BadRequestException('每人最多10个有效委托，请先撤销旧委托');
      return tx.agentGrant.create({
        data: {
          id: grantId,
          tenantId: a.tenantId,
          ownerId: a.userId,
          ownerSessionId: a.sessionId,
          name: input.name,
          purpose: input.purpose,
          tokenHash: this.hash(token),
          contextHash: contextHash(a),
          capabilities: input.capabilities,
          maxCalls: input.maxCalls,
          expiresAt,
        },
        select: grantSelect,
      });
    });
    // Never persist a raw credential in command receipts, audit, logs or list responses.
    return {
      ...(result as Record<string, unknown>),
      ...(result && typeof result === 'object' && 'id' in result && result.id === grantId
        ? { token }
        : { tokenUnavailable: true, message: '委托已创建，凭证仅首次显示；丢失后请撤销并新建' }),
    };
  }
  async revoke(a: Actor, grantId: string, body: Record<string, unknown>) {
    uuid(grantId);
    only(body, ['requestKey', 'reason']);
    const reason = text(body.reason, '撤销原因', 1000);
    return runCommand(this.prisma, a, 'agent.grant.revoke', { ...body, grantId }, async (tx) => {
      const grant = await tx.agentGrant.findFirst({ where: { ...this.scope(a), id: grantId } });
      if (!grant) throw new NotFoundException('委托不存在');
      // Emergency revocation must not race harmless used-call/version increments.
      if (grant.revokedAt) throw new ConflictException('委托已撤销');
      return tx.agentGrant.update({
        where: { id: grantId },
        data: { revokedAt: new Date(), revokeReason: reason },
        select: grantSelect,
      });
    });
  }
  async proposals(a: Actor, after?: string) {
    // Administrators can audit, but only the original owner may authorize an action.
    const rows = await this.prisma.system.agentProposal.findMany({
      where: { ...this.scope(a), ...(await this.cursor(a, 'proposals', after)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
  }
  async executions(a: Actor, after?: string) {
    const rows = await this.prisma.system.agentExecution.findMany({
      where: { ...this.scope(a), ...(await this.cursor(a, 'executions', after)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    });
    return { items: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null };
  }
  async compensate(a: Actor, proposalId: string, body: Record<string, unknown>) {
    uuid(proposalId);
    only(body, ['requestKey', 'expectedUpdatedAt', 'expectedActionUpdatedAt', 'reason']);
    const reason = text(body.reason, '补偿取消原因', 1000);
    return runCommand(this.prisma, a, 'agent.action.compensate', { ...body, proposalId }, async (tx) => {
      const p = await tx.agentProposal.findFirst({
        where: { id: proposalId, tenantId: a.tenantId, ownerId: a.userId },
      });
      if (!p) throw new NotFoundException('建议不存在或不是委托人');
      checkVersion(p, body.expectedUpdatedAt);
      if (p.status !== 'executed' || !p.actionId) throw new ConflictException('只有已执行且未补偿的行动可取消');
      const action = await this.workspace.cancelAgentAction(tx, a, p.actionId, body.expectedActionUpdatedAt);
      return tx.agentProposal.update({
        where: { id: p.id },
        data: {
          status: 'cancelled',
          compensation: json({
            actorId: a.userId,
            reason,
            cancelledAt: new Date(),
            actionId: action.id,
            status: action.status,
          }),
        },
      });
    });
  }
  async receipt(authorization: string | undefined, executionId: string) {
    uuid(executionId);
    const { grant } = await this.context(this.prisma.system, authorization);
    const row = await this.prisma.system.agentExecution.findFirst({
      where: { id: executionId, tenantId: grant.tenantId, grantId: grant.id },
    });
    if (!row) throw new NotFoundException('回执不存在');
    const stored = row.result && typeof row.result === 'object' && !Array.isArray(row.result) ? row.result : {};
    const proposal =
      typeof stored.proposalId === 'string'
        ? await this.prisma.system.agentProposal.findFirst({
            where: { id: stored.proposalId, tenantId: grant.tenantId, grantId: grant.id },
            select: { id: true, status: true, actionId: true, compensation: true, expiresAt: true },
          })
        : null;
    return { ...row, currentProposal: proposal };
  }
  async decide(a: Actor, proposalId: string, decision: 'approved' | 'rejected', body: Record<string, unknown>) {
    uuid(proposalId);
    only(body, ['requestKey', 'expectedUpdatedAt', 'reason']);
    const reason = text(body.reason, '核对意见', 1000);
    return runCommand(this.prisma, a, 'agent.proposal.' + decision, { ...body, proposalId }, async (tx) => {
      const p = await tx.agentProposal.findFirst({
        where: { id: proposalId, tenantId: a.tenantId, ownerId: a.userId },
      });
      if (!p) throw new NotFoundException('建议不存在或不是委托人');
      checkVersion(p, body.expectedUpdatedAt);
      if (p.status !== 'pending' || p.expiresAt <= new Date()) throw new ConflictException('建议已处理或过期');
      const grant = await tx.agentGrant.findUniqueOrThrow({ where: { id: p.grantId } });
      await this.actor(tx, grant);
      if (decision === 'approved') {
        const preview = await this.workspace.previewAction(tx, a, p.input);
        if (
          !(preview.customer.updatedAt instanceof Date) ||
          preview.customer.updatedAt.getTime() !== p.customerVersion.getTime()
        )
          throw new ConflictException('客户已变化，请让智能体重新预演后核对');
      }
      return tx.agentProposal.update({
        where: { id: p.id },
        data: {
          status: decision,
          decisionNote: reason,
          decidedBy: a.userId,
          decidedAt: new Date(),
          updatedAt: new Date(Math.max(Date.now(), p.updatedAt.getTime() + 1)),
        },
      });
    });
  }
  async invoke(authorization: string | undefined, body: Record<string, unknown>): Promise<unknown> {
    const call = invocation(body),
      inputHash = digest({ capabilityId: call.capabilityId, input: call.input });
    const initial = await this.context(this.prisma.system, authorization);
    if (!(initial.grant.capabilities as string[]).includes(call.capabilityId))
      throw new ForbiddenException('委托不包含此能力');
    if (call.capabilityId.startsWith('action.')) {
      try {
        return await this.mutate(authorization, initial.actor, initial.grant.id, call, inputHash);
      } catch (error) {
        // A rejected/rolled-back write has no success receipt. Preserve a separate
        // minimal failure event without raw input or credentials; retry remains possible.
        await this.prisma.system.auditLog
          .create({
            data: {
              tenantId: initial.grant.tenantId,
              userId: initial.grant.ownerId,
              action: 'agent.call.failed',
              objectType: 'agent',
              objectNo: initial.grant.id,
              afterData: json({
                executor: 'agent',
                grantId: initial.grant.id,
                capabilityId: call.capabilityId,
                requestKey: call.requestKey,
                inputHash,
                errorCode: error instanceof HttpException ? error.getStatus() : 500,
              }),
            },
          })
          .catch(() => {
            this.logger.error('Agent failure audit unavailable; request was not reported as successful');
          });
        throw error;
      }
    }
    const executionId = randomUUID(),
      started = Date.now();
    await this.transaction(async (tx) => {
      const { grant } = await this.context(tx, authorization);
      if (
        await tx.agentExecution.findUnique({
          where: { grantId_requestKey: { grantId: grant.id, requestKey: call.requestKey } },
        })
      )
        throw new ConflictException('读取请求已记录，请用新请求编号重新查询当前权限下的数据');
      await this.consume(tx, grant);
      await tx.agentExecution.create({
        data: {
          id: executionId,
          tenantId: grant.tenantId,
          ownerId: grant.ownerId,
          grantId: grant.id,
          capabilityId: call.capabilityId,
          requestKey: call.requestKey,
          inputHash,
          status: 'running',
        },
      });
    });
    try {
      const result = await this.capabilities.invoke(initial.actor, call.capabilityId, call.input, {
        grantId: initial.grant.id,
        agentExecutionId: executionId,
      });
      // Fail closed if revoked, logged out or permissions changed during a multi-query read.
      await this.context(this.prisma.system, authorization);
      const businessExecutionId =
        result && typeof result === 'object' && 'executionId' in result ? String(result.executionId) : null;
      await this.prisma.system.agentExecution.update({
        where: { id: executionId },
        data: {
          status: 'succeeded',
          completedAt: new Date(),
          durationMs: Date.now() - started,
          result: json({ businessExecutionId }),
        },
      });
      return { executionId, grantId: initial.grant.id, executor: 'agent', result };
    } catch (error) {
      await this.prisma.system.agentExecution.update({
        where: { id: executionId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          durationMs: Date.now() - started,
          errorCode: error instanceof HttpException ? error.getStatus() : 500,
        },
      });
      throw error;
    }
  }
  private async consume(tx: Tx, grant: AgentGrant) {
    if (grant.usedCalls >= grant.maxCalls) throw new ForbiddenException('智能体调用预算已用完');
    await tx.agentGrant.update({ where: { id: grant.id }, data: { usedCalls: { increment: 1 } } });
  }
  private async mutate(
    authorization: string | undefined,
    actor: Actor,
    grantId: string,
    call: ReturnType<typeof invocation>,
    inputHash: string,
  ) {
    return runCommand(
      this.prisma,
      actor,
      'agent.' + call.capabilityId,
      { requestKey: 'ag:' + grantId + ':' + call.requestKey, grantId, inputHash },
      async (tx) => {
        const { grant, actor: current } = await this.context(tx, authorization);
        if (!(grant.capabilities as string[]).includes(call.capabilityId))
          throw new ForbiddenException('委托不包含此能力');
        if (
          await tx.agentExecution.findUnique({
            where: { grantId_requestKey: { grantId, requestKey: call.requestKey } },
          })
        )
          throw new ConflictException('请求编号已用于其他智能体调用');
        await this.consume(tx, grant);
        let result: Record<string, unknown>;
        if (call.capabilityId === 'action.propose') {
          const { data, customer } = await this.workspace.previewAction(tx, current, call.input);
          const proposalInput = {
            title: data.title,
            targetId: data.targetId,
            ...(typeof data.content === 'string' ? { content: data.content } : {}),
            ...(data.dueDate instanceof Date ? { dueDate: data.dueDate.toISOString().slice(0, 10) } : {}),
          };
          if (!(customer.updatedAt instanceof Date)) throw new ConflictException('客户版本不可核对');
          const p = await tx.agentProposal.create({
            data: {
              id: randomUUID(),
              tenantId: grant.tenantId,
              grantId: grant.id,
              ownerId: grant.ownerId,
              requestKey: call.requestKey,
              inputHash,
              input: json(proposalInput),
              customerId: customer.id,
              customerVersion: customer.updatedAt,
              customerName: String(customer.name),
              expiresAt: new Date(Math.min(Date.now() + 30 * 60000, grant.expiresAt.getTime())),
            },
          });
          result = {
            proposalId: p.id,
            status: p.status,
            expiresAt: p.expiresAt,
            input: proposalInput,
            customer: { id: customer.id, name: customer.name, updatedAt: customer.updatedAt },
            requiresHumanApproval: true,
          };
        } else {
          only(call.input, ['proposalId']);
          const proposalId = uuid(call.input.proposalId);
          const p = await tx.agentProposal.findFirst({
            where: { id: proposalId, tenantId: grant.tenantId, grantId: grant.id },
          });
          if (!p) throw new NotFoundException('建议不存在');
          if (p.status === 'executed') result = { proposalId: p.id, status: 'executed', actionId: p.actionId };
          else {
            if (p.status !== 'approved' || p.decidedBy !== current.userId || p.expiresAt <= new Date())
              throw new ForbiddenException('建议未获委托人批准、已拒绝或过期');
            const { customer } = await this.workspace.previewAction(tx, current, p.input);
            if (!(customer.updatedAt instanceof Date) || customer.updatedAt.getTime() !== p.customerVersion.getTime())
              throw new ConflictException('客户已变化，请重新预演和核对');
            const action = await this.workspace.createAction(tx, current, p.input, 'ai_recommend');
            await tx.agentProposal.update({ where: { id: p.id }, data: { status: 'executed', actionId: action.id } });
            result = { proposalId: p.id, status: 'executed', actionId: action.id };
          }
        }
        const executionId = randomUUID();
        await tx.agentExecution.create({
          data: {
            id: executionId,
            tenantId: grant.tenantId,
            grantId: grant.id,
            ownerId: grant.ownerId,
            capabilityId: call.capabilityId,
            requestKey: call.requestKey,
            inputHash,
            status: 'succeeded',
            result: json(result),
            completedAt: new Date(),
          },
        });
        return { executionId, grantId: grant.id, executor: 'agent', capabilityId: call.capabilityId, result };
      },
      async (tx) => {
        await this.context(tx, authorization);
      },
    );
  }
}
