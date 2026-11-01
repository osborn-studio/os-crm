import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type Contract } from '@prisma/client';
import { checkVersion, object, text, type Tx } from './command-runner';
export type ContractPatch = {
  amount?: string;
  taxRate?: string;
  startDate?: string | null;
  endDate?: string | null;
  paymentTerms?: string;
  status?: 'terminated';
};
export async function recalculateCustomerContracts(tx: Tx, tenantId: number, customerId: number) {
  const totals = await tx.contract.aggregate({
    where: { tenantId, customerId, deletedAt: null, status: { in: ['signed', 'executing', 'completed'] } },
    _sum: { amount: true },
    _count: true,
  });
  if (totals._sum.amount?.gt('9999999999999.99')) throw new BadRequestException('客户累计有效合同金额超出支持范围');
  await tx.customer.update({
    where: { id: customerId, tenantId },
    data: {
      contractAmount: totals._sum.amount ?? 0,
      contractCount: totals._count,
      isTrading: totals._count > 0,
      ...(totals._count > 0 ? { isProspect: false } : {}),
    },
  });
}
export function contractSnapshot(c: Contract) {
  return {
    amount: c.amount.toFixed(2),
    taxRate: (c.taxRate ?? new Prisma.Decimal(13)).toString(),
    startDate: c.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: c.endDate?.toISOString().slice(0, 10) ?? null,
    paymentTerms: c.paymentTerms,
    status: c.status,
    updatedAt: c.updatedAt.toISOString(),
  };
}
export function changePatch(type: string, input: unknown): ContractPatch {
  const data = object(input),
    allowed: Record<string, string[]> = {
      amount: ['amount', 'taxRate'],
      schedule: ['startDate', 'endDate'],
      terms: ['paymentTerms'],
      terminate: [],
    };
  if (!Object.hasOwn(allowed, type) || Object.keys(data).some((k) => !allowed[type].includes(k)))
    throw new BadRequestException('不支持的变更类型或字段');
  const patch: ContractPatch = {};
  if (type === 'amount') {
    if (
      typeof data.amount !== 'string' ||
      !/^\d{1,13}(\.\d{1,2})?$/.test(data.amount) ||
      new Prisma.Decimal(data.amount).lte(0)
    )
      throw new BadRequestException('新金额须为正数文本，最多两位小数');
    patch.amount = new Prisma.Decimal(data.amount).toFixed(2);
    if (data.taxRate !== undefined) {
      if (
        typeof data.taxRate !== 'string' ||
        !/^\d{1,3}(\.\d{1,2})?$/.test(data.taxRate) ||
        new Prisma.Decimal(data.taxRate).gt(100)
      )
        throw new BadRequestException('税率需为0—100的数值文本');
      patch.taxRate = new Prisma.Decimal(data.taxRate).toString();
    }
  }
  if (type === 'terms') patch.paymentTerms = text(data.paymentTerms, '付款条款', 200);
  if (type === 'schedule') {
    if (!Object.keys(data).length) throw new BadRequestException('至少设置一个合同日期');
    for (const key of ['startDate', 'endDate'] as const)
      if (key in data) {
        const value = data[key];
        if (
          value !== null &&
          (typeof value !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            Number(value.slice(0, 4)) < 1000 ||
            !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value)
        )
          throw new BadRequestException('日期需为有效的YYYY-MM-DD或空值');
        patch[key] = value as string | null;
      }
  }
  if (type === 'terminate') patch.status = 'terminated';
  return patch;
}
export async function changeEligible(tx: Tx, c: Contract) {
  if (!['signed', 'executing'].includes(c.status)) throw new BadRequestException('仅已签约或执行中的合同可变更');
  // Downstream compensation is an explicit later milestone, never silently rewritten here.
  if (
    (await tx.order.count({ where: { tenantId: c.tenantId, contractId: c.id, deletedAt: null } })) ||
    (await tx.project.count({ where: { tenantId: c.tenantId, contractId: c.id, deletedAt: null } })) ||
    (await tx.invoice.count({ where: { tenantId: c.tenantId, contractId: c.id } })) ||
    (await tx.receiptAllocation.count({
      where: { tenantId: c.tenantId, paymentPlan: { contractId: c.id, tenantId: c.tenantId } },
    })) ||
    c.totalReceived.gt(0) ||
    c.totalInvoiced.gt(0)
  )
    throw new ConflictException('已有订单、项目、开票或核销，请先完成下游变更/冲销对账；本批不改写已执行业务');
  const plans = await tx.paymentPlan.findMany({
    where: { tenantId: c.tenantId, contractId: c.id, status: { not: 'cancelled' } },
  });
  if (
    plans.length !== 1 ||
    plans[0].receivedAmount.gt(0) ||
    plans[0].invoiceId !== null ||
    !plans[0].amount.eq(c.amount)
  )
    throw new ConflictException('当前回款计划已拆分或执行，需先完成财务对账');
}
export async function applyContractChange(
  tx: Tx,
  tenantId: number,
  changeId: number,
  approvalId: number,
  status: 'approved' | 'rejected' | 'draft',
  approverId?: number,
) {
  const change = await tx.contractChange.findFirst({
    where: { id: changeId, tenantId, approvalId, status: 'pending' },
  });
  if (!change) throw new ConflictException('变更申请已处理或审批关联无效');
  if (status !== 'approved') {
    await tx.contractChange.update({
      where: { id: changeId },
      data: { status: status === 'draft' ? 'withdrawn' : 'rejected' },
    });
    return;
  }
  const c = await tx.contract.findFirst({ where: { id: change.contractId, tenantId, deletedAt: null } });
  if (!c) throw new ConflictException('原合同不存在');
  const before = object(JSON.parse(change.beforeValue)),
    patch = changePatch(change.changeType, JSON.parse(change.afterValue));
  checkVersion(c, before.updatedAt);
  await changeEligible(tx, c);
  const amount = new Prisma.Decimal(patch.amount ?? c.amount),
    taxRate = new Prisma.Decimal(patch.taxRate ?? c.taxRate ?? 13),
    amountExclTax = amount.div(taxRate.div(100).add(1)).toDecimalPlaces(2);
  await tx.contract.update({
    where: { id: c.id },
    data: {
      amount,
      taxRate,
      amountExclTax,
      taxAmount: amount.sub(amountExclTax),
      totalOutstanding: patch.status === 'terminated' ? 0 : amount,
      ...(patch.paymentTerms !== undefined ? { paymentTerms: patch.paymentTerms } : {}),
      ...(patch.startDate !== undefined
        ? { startDate: patch.startDate === null ? null : new Date(patch.startDate) }
        : {}),
      ...(patch.endDate !== undefined ? { endDate: patch.endDate === null ? null : new Date(patch.endDate) } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      updatedBy: approverId,
    },
  });
  await tx.paymentPlan.updateMany({
    where: { tenantId, contractId: c.id, status: { not: 'cancelled' } },
    data:
      patch.status === 'terminated'
        ? { status: 'cancelled', outstandingAmount: 0 }
        : { amount, outstandingAmount: amount },
  });
  await tx.contractChange.update({
    where: { id: changeId },
    data: { status: 'approved', approvedBy: approverId, approvedAt: new Date() },
  });
  await recalculateCustomerContracts(tx, tenantId, c.customerId);
}
