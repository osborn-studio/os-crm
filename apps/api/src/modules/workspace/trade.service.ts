import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { checkVersion, json, runCommand, validateActor } from './command-runner';
import { contractTrades } from './trade-store';
import { projectRegisterBody } from './project-register-policy';
import { businessDay } from './analytics-policy';
import {hasPermission} from './access';
import { tradeBody, tradeProvider, currentTrade, type TradeClassification } from './trade-policy';
@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  schema() {
    return [
      {
        id: 'sales.trade.classify',
        version: '1.0',
        endpoint: 'POST /trade/classify',
        permission: 'super_admin',
        effect: 'classification-write',
        agentWritesEnabled: false,
        inputSchema: zSchema(),
        outputSchema: { type: 'object', required: ['items', 'externalEffects'] },
        guards: [
          'live authenticated company administrator',
          'object scope and current versions',
          'original amounts unchanged',
          'sum of known own and vendor components equals quote',
          'serializable idempotent audit',
          'no financial or external effects',
        ],
      },
      {
        id: 'project.history.register',
        version: '1.0',
        endpoint: 'POST /trade/project-register',
        permission: 'super_admin',
        effect: 'historical-project-write',
        agentWritesEnabled: false,
        inputSchema: z.toJSONSchema(projectRegisterBody),
        outputSchema: { type: 'object', required: ['projects', 'externalEffects', 'actualAcceptancesCreated'] },
        guards: [
          'live company administrator',
          'signed contract current version and active owner',
          'one existing project per contract preserved',
          'planned dates and unknown actual progress explicitly labelled',
          'no new approval or acceptance event',
          'serializable idempotent audit',
        ],
      },
    ];
  }
  async detail(a: Actor, kind: string, id: number) {
    if (!['contracts', 'opportunities'].includes(kind) || !Number.isSafeInteger(id) || id <= 0)
      throw new BadRequestException('分类对象无效');
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const scope = await this.workspace.scope(tx, a, kind);
        const row =
          kind === 'contracts'
            ? await tx.contract.findFirst({ where: { AND: [scope, { id }] } })
            : await tx.opportunity.findFirst({ where: { AND: [scope, { id }] } });
        if (!row) throw new NotFoundException('记录不存在或无权访问');
        const classification =
          kind === 'contracts' ? (await contractTrades(tx, a.tenantId, [id])).get(id) : currentTrade(row);
        return {
          kind,
          id,
          originalAmount: row.amount.toFixed(2),
          updatedAt: row.updatedAt,
          classification: classification?.category ? classification : null,
          canClassify: a.roles.includes('super_admin'),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async registerProjects(a: Actor, input: Record<string, unknown>) {
    if (!a.roles.includes('super_admin')) throw new ForbiddenException('历史在建登记仅限管理员');
    const parsed = projectRegisterBody.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '登记参数无效');
    const body = parsed.data;
    if (new Set(body.contracts.map((c) => c.id)).size !== body.contracts.length)
      throw new BadRequestException('合同重复');
    return runCommand(this.prisma, a, 'project.history.register@1.0', body, async (tx) => {
      const scope = await this.workspace.scope(tx, a, 'contracts');
      await this.workspace.scope(tx, a, 'projects');
      const rows = [];
      for (const item of body.contracts) {
        const c = await tx.contract.findFirst({ where: { AND: [scope, { id: item.id }] } });
        if (!c) throw new NotFoundException('合同不存在或无权访问');
        checkVersion(c, item.expectedUpdatedAt);
        if (!['signed', 'executing', 'completed'].includes(c.status))
          throw new BadRequestException('只能登记已有已签约合同的历史在建项目');
        const existing = await tx.project.findFirst({
          where: { tenantId: a.tenantId, contractId: c.id, deletedAt: null },
        });
        if (existing) {
          rows.push({ contractId: c.id, projectId: existing.id, created: false });
          continue;
        }
        const owner = await tx.user.findFirst({
          where: { id: c.ownerId, tenantId: a.tenantId, status: 'active', deletedAt: null },
        });
        if (!owner) throw new BadRequestException('请先核实有效的项目负责人');
        const plannedStartDate = c.signDate ?? new Date(businessDay(new Date()) + 'T00:00:00Z'),
          plannedEndDate = new Date(item.plannedEndDate + 'T00:00:00Z');
        if (plannedEndDate < plannedStartDate) throw new BadRequestException('预计收尾日期不能早于签约日期');
        const linked=hasPermission(a,'opportunity:read')?await tx.opportunity.findFirst({where:{AND:[await this.workspace.scope(tx,a,'opportunities'),{contractId:c.id,status:'won'}]},select:{id:true}}):null;
        const project = await tx.project.create({
          data: {
            tenantId: a.tenantId,
            projectNo: 'HB' + randomUUID().replaceAll('-', '').slice(0, 20),
            name: c.name,
            contractId: c.id,
            customerId: c.customerId,
            opportunityId: c.opportunityId??linked?.id,
            pmId: owner.id,
            salesOwnerId: c.ownerId,
            stage: item.stage,
            status: 'active',
            plannedStartDate,
            plannedEndDate,
            progress: 0,
            remark:
              '[历史在建登记；不是新立项审批]\n' +
              item.reason +
              '\n[计划日期估算]起点按原合同签约日，结束为推进安排；实际开工、进度百分比、验收及客户承诺时间待核，未补造业务事实。',
            createdBy: a.userId,
          },
        });
        const id = randomUUID(),
          snapshot = {
            contractId: c.id,
            projectId: project.id,
            stage: item.stage,
            reason: item.reason,
            sourceIds: item.sourceIds,
            plannedDatesEstimated: true,
            actualEventsCreated: false,
          };
        await tx.integrationRun.create({
          data: {
            id,
            tenantId: a.tenantId,
            provider: tradeProvider,
            kind: 'project-register',
            status: 'applied',
            actorId: a.userId,
            bindingHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
            snapshot: json(snapshot),
          },
        });
        await tx.contract.update({
          where: { id: c.id },
          data: { updatedAt: new Date(Math.max(Date.now(), c.updatedAt.getTime() + 1)) },
        });
        rows.push({ contractId: c.id, projectId: project.id, created: true });
      }
      return { projects: rows, externalEffects: [], actualAcceptancesCreated: 0 };
    });
  }
  async classify(a: Actor, input: Record<string, unknown>) {
    if (!a.roles.includes('super_admin')) throw new ForbiddenException('交易性质和金额拆分仅限管理员确认');
    const parsed = tradeBody.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? '分类参数无效');
    const body = parsed.data;
    if (new Set(body.items.map((i) => i.kind + ':' + i.id)).size !== body.items.length)
      throw new BadRequestException('分类对象重复');
    return runCommand(this.prisma, a, 'sales.trade.classify@1.0', body, async (tx) => {
      const results = [];
      for (const i of body.items) {
        const scope = await this.workspace.scope(tx, a, i.kind),
          row =
            i.kind === 'contracts'
              ? await tx.contract.findFirst({ where: { AND: [scope, { id: i.id }] } })
              : await tx.opportunity.findFirst({ where: { AND: [scope, { id: i.id }] } });
        if (!row) throw new NotFoundException('记录不存在或无权访问');
        checkVersion(row, i.expectedUpdatedAt);
        if (i.kind === 'contracts' && (i.ownAmount !== undefined || i.vendorProductAmount !== undefined))
          throw new BadRequestException('合同保留原金额，仅确认交易性质；整包报价在商机中拆分');
        if (
          i.kind === 'opportunities' &&
          i.category === 'business' &&
          i.ownAmount !== undefined &&
          i.ownAmount !== null &&
          !new Prisma.Decimal(i.ownAmount).add(i.vendorProductAmount ?? 0).eq(row.amount)
        )
          throw new BadRequestException('我方金额与厂商产品金额之和必须等于原报价');
        const data: TradeClassification = {
          category: i.category,
          ...(i.kind === 'opportunities'
            ? {
                ownAmount: i.category === 'software_commission' ? '0.00' : (i.ownAmount ?? null),
                vendorProductAmount: i.vendorProductAmount ?? '0.00',
              }
            : {}),
          originalAmount: row.amount.toFixed(2),
          reason: i.reason,
          sourceIds: i.sourceIds,
          recordedAt: new Date().toISOString(),
          recordedBy: a.userId,
        };
        const updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
        if (i.kind === 'opportunities') {
          const healthFactors =
            'healthFactors' in row &&
            row.healthFactors &&
            typeof row.healthFactors === 'object' &&
            !Array.isArray(row.healthFactors)
              ? row.healthFactors
              : {};
          await tx.opportunity.update({
            where: { id: i.id, tenantId: a.tenantId },
            data: { healthFactors: json({ ...healthFactors, tradeClassification: data }), updatedAt },
          });
        } else await tx.contract.update({ where: { id: i.id, tenantId: a.tenantId }, data: { updatedAt } });
        const id = randomUUID(),
          bindingHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
        await tx.integrationRun.create({
          data: {
            id,
            tenantId: a.tenantId,
            provider: tradeProvider,
            kind: i.kind,
            status: 'applied',
            actorId: a.userId,
            bindingHash,
            snapshot: json(data),
          },
        });
        await tx.integrationMapping.upsert({
          where: {
            tenantId_provider_kind_localId: {
              tenantId: a.tenantId,
              provider: tradeProvider,
              kind: i.kind,
              localId: i.id,
            },
          },
          create: {
            tenantId: a.tenantId,
            provider: tradeProvider,
            kind: i.kind,
            localId: i.id,
            externalId: id,
            externalName: i.category,
            bindingHash,
          },
          update: { externalId: id, externalName: i.category, bindingHash },
        });
        results.push({ kind: i.kind, id: i.id, updatedAt, classification: data });
      }
      return { items: results, externalEffects: [] };
    });
  }
}
import { z } from 'zod';
const zSchema = () => z.toJSONSchema(tradeBody);
