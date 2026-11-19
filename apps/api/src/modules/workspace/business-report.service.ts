import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Actor } from '../../common/types/actor';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { validateActor } from './command-runner';
import { statisticsScope } from './statistics-scope';
import { hasPermission } from './access';
import { reportQuery } from './analytics-policy';
import { contractTrades } from './trade-store';
import { businessReport } from './business-report-policy';
const bounded = <T>(rows: T[]) => {
  if (rows.length > 10000) throw new BadRequestException('数据超过10000条，请缩小日期或人员范围；未返回截断汇总');
  return rows;
};
@Injectable()
export class BusinessReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceService,
  ) {}
  async read(a: Actor, query: Record<string, string>) {
    const q = reportQuery(query);
    return this.prisma.system.$transaction(
      async (tx) => {
        await validateActor(tx, a);
        const audience = await statisticsScope(tx, a, query);
        const scope = await this.workspace.scope(tx, a, 'contracts');
        // Require finance permission through the same record policy before loading totals.
        const planScope = await this.workspace.scope(tx, a, 'payment-plans'),
          invoiceScope = await this.workspace.scope(tx, a, 'invoices');
        const projectAccess = hasPermission(a, 'project:read');
        const contracts = bounded(
          await tx.contract.findMany({
            where: {
              AND: [
                scope,
                {
                  currency: 'CNY',
                  status: { in: ['signed', 'executing', 'completed'] },
                  signDate: { gte: q.start, lt: q.end },
                },
                ...(audience.ownerIds ? [{ ownerId: { in: audience.ownerIds } }] : []),
                ...(q.contractId ? [{ id: q.contractId }] : []),
              ],
            },
            select: {
              id: true,
              contractNo: true,
              name: true,
              customerId: true,
              ownerId: true,
              amount: true,
              currency: true,
              status: true,
              signDate: true,
              totalReceived: true,
              totalOutstanding: true,
            },
            take: 10001,
          }),
        );
        const ids = contracts.map((c) => c.id);
        const plans = bounded(
          await tx.paymentPlan.findMany({
            where: { AND: [planScope, { contractId: { in: ids } }] },
            select: {
              id: true,
              contractId: true,
              amount: true,
              receivedAmount: true,
              outstandingAmount: true,
              dueDate: true,
              status: true,
              invoiceId: true,
            },
            take: 10001,
          }),
        );
        const invoices = bounded(
          await tx.invoice.findMany({
            where: { AND: [invoiceScope, { contractId: { in: ids } }] },
            select: { id: true, contractId: true, amount: true, status: true, direction: true },
            take: 10001,
          }),
        );
        const projects = projectAccess
          ? bounded(
              await tx.project.findMany({
                where: { AND: [await this.workspace.scope(tx, a, 'projects'), { contractId: { in: ids } }] },
                select: {
                  id: true,
                  contractId: true,
                  name: true,
                  status: true,
                  stage: true,
                  plannedEndDate: true,
                  acceptanceState: true,
                },
                take: 10001,
              }),
            )
          : [];
        const customers = await tx.customer.findMany({
          where: { tenantId: a.tenantId, id: { in: [...new Set(contracts.map((c) => c.customerId))] } },
          select: { id: true, name: true, customerCategory: true, channelBrand: true },
        });
        const trades = await contractTrades(tx, a.tenantId, ids);
        const result = businessReport(
          contracts,
          plans,
          invoices,
          projects,
          trades,
          new Map(customers.map((c) => [c.id, c])),
          q,
        );
        const owners = await tx.user.findMany({
          where: { tenantId: a.tenantId, id: { in: [...new Set(contracts.map((c) => c.ownerId))] } },
          select: { id: true, name: true },
        });
        const names = new Map(owners.map((u) => [u.id, u.name]));
        return {
          version: '1.0',
          generatedAt: new Date().toISOString(),
          audience,
          projectAccess,
          period: {
            from: q.start.toISOString().slice(0, 10),
            to: new Date(q.end.getTime() - 1).toISOString().slice(0, 10),
          },
          currency: 'CNY',
          ...result,
          contracts: {
            ...result.contracts,
            items: result.contracts.items.map((r) => ({ ...r, ownerName: names.get(r.ownerId) ?? '历史负责人' })),
          },
          cashProjection: {
            ...result.cashProjection,
            details: {
              ...result.cashProjection.details,
              items: result.cashProjection.details.items.map((r) => ({
                ...r,
                ownerName: names.get(r.ownerId) ?? '历史负责人',
              })),
            },
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 },
    );
  }
}
