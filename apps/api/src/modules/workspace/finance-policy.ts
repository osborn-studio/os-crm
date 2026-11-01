import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, type Receipt } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { Actor } from '../../common/types/actor';
import { admin } from './access';
import { object, type Tx } from './command-runner';
export function ledgerWriter(a: Actor) {
  if (!admin(a)) throw new ForbiddenException('当前仅管理员可登记、复核和处理本地收款台账');
}
export function ledgerKeys(body: Record<string, unknown>, allowed: string[]) {
  object(body);
  if (Object.keys(body).some((k) => !allowed.includes(k))) throw new BadRequestException('存在未定义参数');
}
export function ledgerMoney(v: unknown) {
  if (typeof v !== 'string' || !/^\d{1,13}(\.\d{1,2})?$/.test(v) || new Prisma.Decimal(v).lte(0))
    throw new BadRequestException('金额须为正数十进制文本，最多两位小数');
  return new Prisma.Decimal(v);
}
export function ledgerDate(v: unknown) {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    Number(v.slice(0, 4)) < 1000 ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new BadRequestException('日期须为有效YYYY-MM-DD');
  return new Date(v + 'T00:00:00Z');
}
export const referenceKey = (v: string) => createHash('sha256').update(v.normalize('NFKC').trim()).digest('hex');
export const ledgerStamp = (d: Date) => new Date(Math.max(Date.now(), d.getTime() + 1));
export async function receiptBalance(tx: Tx, r: Receipt) {
  const total =
    (
      await tx.receiptAllocation.aggregate({
        where: { tenantId: r.tenantId, receiptId: r.id, active: true },
        _sum: { amount: true },
      })
    )._sum.amount ?? new Prisma.Decimal(0);
  if (
    total.lt(0) ||
    total.gt(r.amount) ||
    !r.allocatedAmount.eq(total) ||
    !r.unallocatedAmount.eq(r.status === 'voided' ? 0 : r.amount.sub(total))
  )
    throw new ConflictException('收款余额与有效核销明细不符，请先人工对账');
}
export async function contractBalances(tx: Tx, tenantId: number, contractId: number) {
  const c = await tx.contract.findFirst({ where: { tenantId, id: contractId, deletedAt: null } });
  if (!c || !['signed', 'executing', 'completed'].includes(c.status))
    throw new ConflictException('合同未签约、已终止或不可用');
  if (await tx.contractChange.count({ where: { tenantId, contractId, status: 'pending' } }))
    throw new ConflictException('合同变更处理中，禁止财务核销');
  const plans = await tx.paymentPlan.findMany({ where: { tenantId, contractId, status: { not: 'cancelled' } } });
  let planned = new Prisma.Decimal(0),
    received = new Prisma.Decimal(0);
  for (const p of plans) {
    const sum =
      (
        await tx.receiptAllocation.aggregate({
          where: { tenantId, paymentPlanId: p.id, active: true },
          _sum: { amount: true },
        })
      )._sum.amount ?? new Prisma.Decimal(0);
    if (sum.lt(0) || sum.gt(p.amount) || !p.receivedAmount.eq(sum) || !p.outstandingAmount.eq(p.amount.sub(sum)))
      throw new ConflictException('回款计划余额与有效核销不符，请先人工对账');
    planned = planned.add(p.amount);
    received = received.add(sum);
  }
  if (!planned.eq(c.amount) || !c.totalReceived.eq(received) || !c.totalOutstanding.eq(c.amount.sub(received)))
    throw new ConflictException('合同与回款计划余额不符，请先人工对账');
  return c;
}
