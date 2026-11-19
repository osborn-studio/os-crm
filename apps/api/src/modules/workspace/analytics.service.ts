import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
import { WorkspaceService } from './workspace.service';
import { hasPermission } from './access';
import { statisticsOptions, statisticsScope } from './statistics-scope';
import { validateActor } from './command-runner';
import { reportQuery, forecastReport, collectionReport } from './analytics-policy';
const LIMIT = 10000;
function bounded<T>(rows: T[]) {
  if (rows.length > LIMIT)
    throw new BadRequestException('本次报表超过10000条查询预算，请缩小负责人或所选时间内范围；系统未返回截断统计');
  return rows;
}
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  async options(a: Actor) {
    if (!hasPermission(a, 'opportunity:read') && !hasPermission(a, 'finance:read'))
      throw new ForbiddenException('没有报表权限');
    const tx = this.prisma.system;
    await validateActor(tx, a);
    return {
      ...await statisticsOptions(tx, a),
      canForecast: hasPermission(a, 'opportunity:read'),
      canCollections: hasPermission(a, 'finance:read') && hasPermission(a, 'contract:read'),
    };
  }
  async forecast(a: Actor, query: Record<string, string>) {
    const q = reportQuery(query);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const scope = await this.workspace.scope(tx, a, 'opportunities');
        const audience = await statisticsScope(tx, a, query);
        const rows = bounded(
          await tx.opportunity.findMany({
            where: {
              AND: [
                scope,
                ...(audience.ownerIds ? [{ ownerId: { in: audience.ownerIds } }] : []),
                {
                  OR: [
                    { expectedCloseDate: { gte: q.start, lt: q.end } },
                    { expectedCloseDate: null },
                    {
                      closedAt: {
                        gte: new Date(q.start.getTime() - 8 * 3600000),
                        lt: new Date(q.end.getTime() - 8 * 3600000),
                      },
                    },
                    { status: { not: 'open' }, closedAt: null },
                  ],
                },
              ],
            },
            select: {
              id: true,
              name: true,
              ownerId: true,
              stage: true,
              status: true,
              amount: true,
              healthFactors: true,
              expectedCloseDate: true,
              closedAt: true,
              nextAction: true,
              nextActionDate: true,
            },
            orderBy: [{ expectedCloseDate: 'asc' }, { id: 'asc' }],
            take: LIMIT + 1,
          }),
        );
        const stages = await tx.opportunityStage.findMany({
          where: { tenantId: a.tenantId },
          select: { code: true, name: true, probability: true, isActive: true },
        });
        const result = forecastReport(rows, stages, q);
        const owners = await tx.user.findMany({
          where: { tenantId: a.tenantId, id: { in: [...new Set(rows.map((r) => r.ownerId))] } },
          select: { id: true, name: true },
        });
        const names = new Map(owners.map((u) => [u.id, u.name]));
        return {
          version: '1.0',
          audience,
          generatedAt: new Date().toISOString(),
          period: { year: q.year, month: q.month, from: q.start.toISOString().slice(0,10), to: new Date(q.end.getTime()-1).toISOString().slice(0,10), explicitRange: q.explicitRange },
          currency: 'CNY',
          scope: '当前归属权限；预计成交日期归期；关闭日使用Asia/Shanghai；缺日期池为当前可见范围全部年份',
          ...result,
          owners: result.owners.map((r) => ({ ...r, name: names.get(r.ownerId) ?? '历史负责人' })),
          details: {
            ...result.details,
            items: result.details.items.map((r) => ({ ...r, ownerName: names.get(r.ownerId) ?? '历史负责人' })),
          },
          notices: [
            '按进度折算是规则预测，不是销售承诺或AI预测。',
            '停用/未知阶段不计加权额；已赢单与开放商机互斥。',
            '未知总价和未明确期限的月费不混入预测金额；金额使用当前值，尚无历史快照/预测提报及锁定。',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
  async collections(a: Actor, query: Record<string, string>) {
    const q = reportQuery(query);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const contractScope = await this.workspace.scope(tx, a, 'contracts');
        const receiptScope = await this.workspace.scope(tx, a, 'receipts');
        const planScope = await this.workspace.scope(tx, a, 'payment-plans');
        const audience = await statisticsScope(tx, a, query);
        const base: Prisma.ContractWhereInput = {
          AND: [
            contractScope,
            ...(audience.ownerIds ? [{ ownerId: { in: audience.ownerIds } }] : []),
            ...(q.contractId ? [{ id: q.contractId }] : []),
          ],
        };
        const excludedCurrencyContracts = await tx.contract.count({
          where: { AND: [base, { currency: { not: 'CNY' } }] },
        });
        const contracts = bounded(
          await tx.contract.findMany({
            where: { AND: [base, { currency: 'CNY' }] },
            select: {
              id: true,
              contractNo: true,
              name: true,
              ownerId: true,
              amount: true,
              currency: true,
              signDate: true,
              status: true,
            },
            orderBy: { id: 'desc' },
            take: LIMIT + 1,
          }),
        );
        const ids = contracts.map((c) => c.id);
        const plans = bounded(
          await tx.paymentPlan.findMany({
            where: { AND: [planScope, { contractId: { in: ids } }] },
            select: {
              id: true,
              planNo: true,
              contractId: true,
              amount: true,
              receivedAmount: true,
              outstandingAmount: true,
              dueDate: true,
              status: true,
            },
            orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
            take: LIMIT + 1,
          }),
        );
        const receipts = bounded(
          await tx.receipt.findMany({
            where: {
              AND: [
                receiptScope,
                {
                  ledgerManaged: q.source === 'managed',
                  status: 'confirmed',
                  receiptDate: { gte: q.start, lt: q.end },
                },
                audience.ownerIds !== null || q.contractId
                  ? { contractId: { in: ids } }
                  : { OR: [{ contractId: { in: ids } }, { contractId: null }] },
              ],
            },
            select: {
              id: true,
              receiptNo: true,
              contractId: true,
              amount: true,
              allocatedAmount: true,
              unallocatedAmount: true,
              receiptDate: true,
              status: true,
              ledgerManaged: true,
            },
            orderBy: [{ receiptDate: 'desc' }, { id: 'desc' }],
            take: LIMIT + 1,
          }),
        );
        const result = collectionReport(contracts, plans, receipts, q);
        const users = await tx.user.findMany({
          where: { tenantId: a.tenantId, id: { in: [...new Set(contracts.map((c) => c.ownerId))] } },
          select: { id: true, name: true },
        });
        const names = new Map(users.map((u) => [u.id, u.name]));
        const contractNames = new Map(contracts.map((c) => [c.id, c.name]));
        return {
          version: '1.0',
          audience,
          generatedAt: new Date().toISOString(),
          period: { year: q.year, month: q.month, from: q.start.toISOString().slice(0,10), to: new Date(q.end.getTime()-1).toISOString().slice(0,10), explicitRange: q.explicitRange },
          source: q.source,
          currency: 'CNY',
          balanceAsOf: q.today.toISOString().slice(0, 10),
          excludedCurrencyContracts,
          ...result,
          owners: result.owners.map((r) => ({ ...r, name: names.get(r.ownerId) ?? '历史负责人' })),
          matrix: {
            ...result.matrix,
            items: result.matrix.items.map((c) => ({ ...c, ownerName: names.get(c.ownerId) ?? '历史负责人' })),
          },
          receipts: {
            ...result.receipts,
            items: result.receipts.items.map((r) => ({
              ...r,
              contractName: r.contractId ? (contractNames.get(r.contractId) ?? '历史合同') : '待绑定合同（不归属销售）',
            })),
          },
          balances: {
            ...result.balances,
            items: result.balances.items.map((p) => ({
              ...p,
              contractName: contractNames.get(p.contractId) ?? '历史合同',
            })),
          },
          overdue: {
            ...result.overdue,
            items: result.overdue.items.map((p) => ({
              ...p,
              contractName: contractNames.get(p.contractId) ?? '历史合同',
            })),
          },
          plans: {
            ...result.plans,
            items: result.plans.items.map((p) => ({
              ...p,
              contractName: contractNames.get(p.contractId) ?? '历史合同',
            })),
          },
          notices: [
            ...(result.summary.undatedPlanCount ? [`有${result.summary.undatedPlanCount}条计划未填预计回款日，余额${result.summary.undatedOutstanding}元${q.explicitRange ? '待补日期后纳入所选区间余额' : '仍计入全部应收并单列日期待补'}；不编造月度计划或逾期。`] : []),
            '到账按收款日期归期，仅包含当前已复核或有来源的历史导入且未作废记录；不是银行核验。',
            '已核销/未核销及应收余额为当前值，不是历史月末余额；不与到账重复相加。',
            '计划按预计收款日期统计，不能代替客户承诺日期；旧签约规则生成的30天计划需核对付款条款。',
            q.explicitRange ? '起止日期同时筛选计划、到账及对应收款计划的当前余额/账龄；不是所选结束日的历史余额快照。按销售筛选排除未绑定合同款。' : '旧版年份/月参数仅筛选计划收款/到账；当前余额和账龄不受所选时间内限制。按销售筛选排除未绑定合同款。',
            q.source === 'legacy'
              ? '当前为历史只读记录，不计入正式台账实绩。'
              : '当前为本地管理台账；未绑定合同到账单列，不强行归销售。',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
}
