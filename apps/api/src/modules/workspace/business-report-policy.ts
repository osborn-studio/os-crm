import { Prisma, type Contract, type Invoice, type PaymentPlan, type Project } from '@prisma/client';
import { businessDay, inPeriod, pageRows, sumMoney, type ReportQuery } from './analytics-policy';
import type { TradeClassification } from './trade-policy';
export type BusinessContract = Pick<
  Contract,
  | 'id'
  | 'contractNo'
  | 'name'
  | 'customerId'
  | 'ownerId'
  | 'amount'
  | 'currency'
  | 'status'
  | 'signDate'
  | 'totalReceived'
  | 'totalOutstanding'
>;
export type BusinessPlan = Pick<
  PaymentPlan,
  'id' | 'contractId' | 'amount' | 'receivedAmount' | 'outstandingAmount' | 'dueDate' | 'status' | 'invoiceId'
>;
export type BusinessInvoice = Pick<Invoice, 'id' | 'contractId' | 'amount' | 'status' | 'direction'>;
export type BusinessProject = Pick<
  Project,
  'id' | 'contractId' | 'name' | 'status' | 'stage' | 'plannedEndDate' | 'acceptanceState'
>;
const d = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);
const max0 = (v: Prisma.Decimal) => Prisma.Decimal.max(0, v);
const addDays = (day: Date, n: number) => new Date(day.getTime() + n * 86400000);
export function businessReport(
  contracts: BusinessContract[],
  plans: BusinessPlan[],
  invoices: BusinessInvoice[],
  projects: BusinessProject[],
  trades: Map<number, TradeClassification>,
  customers: Map<number, { name: string; customerCategory: string; channelBrand: string | null }>,
  q: ReportQuery,
) {
  const cohort = contracts.filter(
    (c) => ['signed', 'executing', 'completed'].includes(c.status) && c.currency === 'CNY' && inPeriod(c.signDate, q),
  );
  const commission = (c: BusinessContract) => trades.get(c.id)?.category === 'software_commission';
  const business = cohort.filter((c) => !commission(c)),
    businessIds = new Set(business.map((c) => c.id));
  const activeProjects = projects.filter(
    (p) =>
      p.contractId !== null &&
      businessIds.has(p.contractId) &&
      ['active', 'on_hold'].includes(p.status) &&
      !['maintenance', 'closed'].includes(p.stage),
  );
  const constructionIds = new Set(activeProjects.map((p) => p.contractId));
  const validInvoices = invoices.filter(
    (i) =>
      cohort.some(c=>c.id===i.contractId) &&
      i.direction === 'output' &&
      ['invoiced', 'sent', 'received', 'verified'].includes(i.status),
  );
  const validPlans = plans.filter((p) => p.status !== 'cancelled');
  let unmatchedInvoiceCount = 0;
  const invoiceBalances = validInvoices.map((i) => {
    const links = validPlans.filter((p) => p.contractId === i.contractId && p.invoiceId === i.id);
    // Exact stage-level attribution only. An invoice without a complete plan link is not assumed unpaid.
    if (!links.length || !d(sumMoney(links.map((p) => p.amount))).eq(i.amount)) {
      if(businessIds.has(i.contractId))unmatchedInvoiceCount++;
      return { id: i.id, contractId: i.contractId, amount: i.amount.toFixed(2), received:null, outstanding: null };
    }
    return {
      id: i.id,
      contractId: i.contractId,
      amount: i.amount.toFixed(2),
      received:Prisma.Decimal.min(i.amount,max0(d(sumMoney(links.map(p=>p.receivedAmount))))).toFixed(2),
      outstanding: max0(d(i.amount).sub(sumMoney(links.map((p) => p.receivedAmount)))).toFixed(2),
    };
  });
  const businessInvoices=validInvoices.filter(i=>businessIds.has(i.contractId)),businessInvoiceBalances=invoiceBalances.filter(i=>businessIds.has(i.contractId));
  const invoiceKnownUnpaid = sumMoney(businessInvoiceBalances.flatMap((i) => (i.outstanding === null ? [] : [i.outstanding])));
  const invoiceKnownReceived=sumMoney(businessInvoiceBalances.flatMap(i=>i.received===null?[]:[i.received]));
  const financialRows = cohort.map((c) => ({
    id: c.id,
    contractNo: c.contractNo,
    name: c.name,
    customerId: c.customerId,
    customerName: customers.get(c.customerId)?.name ?? '客户名字待核实',
    ownerId: c.ownerId,
    signDate: c.signDate,
    amount: c.amount.toFixed(2),
    received: c.totalReceived.toFixed(2),
    outstandingAmount: max0(c.totalOutstanding).toFixed(2),
    category: commission(c) ? 'software_commission' : 'business',
    classificationConfirmed: trades.has(c.id),
    invoiced: sumMoney(validInvoices.filter((i) => i.contractId === c.id).map((i) => i.amount)),
    invoiceReceived:invoiceBalances.some(i=>i.contractId===c.id&&i.received===null)?null:sumMoney(invoiceBalances.filter(i=>i.contractId===c.id).flatMap(i=>i.received===null?[]:[i.received])),
    invoiceUnpaid:invoiceBalances.some(i=>i.contractId===c.id&&i.outstanding===null)?null:sumMoney(invoiceBalances.filter(i=>i.contractId===c.id).flatMap(i=>i.outstanding===null?[]:[i.outstanding])),
    building: constructionIds.has(c.id),
  }));
  const projection: {
    id: string;
    contractId: number;
    planId: number | null;
    name: string;
    customerName: string;
    ownerId: number;
    amount: string;
    expectedDate: string;
    weight: number;
    weighted: string;
    basis: string[];
  }[] = [];
  let inconsistentPlanCount = 0;
  for (const c of business.filter((c) => c.totalOutstanding.gt(0))) {
    const items = validPlans.filter((p) => p.contractId === c.id && p.outstandingAmount.gt(0));
    const balance = sumMoney(items.map((p) => p.outstandingAmount));
    const consistent = d(balance).eq(c.totalOutstanding);
    if (!consistent) inconsistentPlanCount++;
    const sources: { plan: BusinessPlan | null; amount: Prisma.Decimal }[] = consistent
      ? items.map((plan) => ({ plan, amount: plan.outstandingAmount }))
      : [{ plan: null, amount: c.totalOutstanding }];
    for (const s of sources) {
      const p = s.plan,
        basis: string[] = [];
      let weight = 50,
        expectedDate = addDays(q.today, 30);
      const contractProjects = projects.filter((x) => x.contractId === c.id);
      if (c.totalReceived.gt(0)) {
        weight += 10;
        basis.push('该合同已有回款 +10');
      }
      if (p?.invoiceId && validInvoices.some((i) => i.id === p.invoiceId)) {
        weight += 15;
        basis.push('该分期已关联有效发票 +15');
      }
      if (contractProjects.some((x) => x.acceptanceState === 'accepted' || x.status === 'completed')) {
        weight += 10;
        basis.push('系统有已通过验收或已完成项目 +10');
      }
      if (p?.dueDate) {
        weight += 5;
        basis.push('已填分期预计收款日期 +5');
        const overdue = Math.max(0, Math.floor((q.today.getTime() - p.dueDate.getTime()) / 86400000));
        if (overdue > 90) {
          weight -= 25;
          expectedDate = addDays(q.today, 60);
          basis.push('逾期超过90天 -25，预计延后60天');
        } else if (overdue > 30) {
          weight -= 15;
          expectedDate = addDays(q.today, 30);
          basis.push('逾期31—90天 -15，预计延后30天');
        } else if (overdue > 0) {
          expectedDate = addDays(q.today, 14);
          basis.push('已过预计收款日期，预计14天跟催窗口');
        } else {
          expectedDate = new Date(Math.max(p.dueDate.getTime(), addDays(q.today, 7).getTime()));
          basis.push('按预计收款日期，至少保留7天执行窗口');
        }
      } else {
        weight -= 15;
        expectedDate = addDays(q.today, 60);
        basis.push(p ? '分期日期待补 -15，暂按60天安排' : '分期与合同余额未对齐或尚未分期 -15，按合同余额暂排60天');
      }
      const dependency = contractProjects
        .filter((x) => x.status === 'active' && !['maintenance', 'closed'].includes(x.stage))
        .reduce<Date | null>((latest, x) => (!latest || x.plannedEndDate > latest ? x.plannedEndDate : latest), null);
      if (dependency && addDays(dependency, 14) > expectedDate) {
        expectedDate = addDays(dependency, 14);
        basis.push('预计完工后留14天结算窗口；计划完工日须核实');
      }
      weight = Math.min(90, Math.max(20, weight));
      projection.push({
        id: `${c.id}:${p?.id ?? 'balance'}`,
        contractId: c.id,
        planId: p?.id ?? null,
        name: c.name,
        customerName: customers.get(c.customerId)?.name ?? '客户名字待核实',
        ownerId: c.ownerId,
        amount: s.amount.toFixed(2),
        expectedDate: businessDay(new Date(expectedDate.getTime() - 8 * 3600000)),
        weight,
        weighted: s.amount.mul(weight).div(100).toDecimalPlaces(2).toFixed(2),
        basis: ['起始权重50（规则假设）', ...basis],
      });
    }
  }
  const channels = [
    ...new Set(
      cohort.filter((c) => customers.get(c.customerId)?.customerCategory === 'sales_channel').map((c) => c.customerId),
    ),
  ].map((customerId) => {
    const rows = cohort.filter((c) => c.customerId === customerId),
      own = rows.filter((c) => !commission(c)),
      other = rows.filter(commission);
    return {
      id: customerId,
      name: customers.get(customerId)?.name ?? '客户名字待核实',
      channelBrand: customers.get(customerId)?.channelBrand,
      amount: sumMoney(own.map((c) => c.amount)),
      received: sumMoney(own.map((c) => c.totalReceived)),
      outstandingAmount: sumMoney(own.map((c) => max0(c.totalOutstanding))),
      commission: sumMoney(other.map((c) => c.amount)),
      commissionReceived: sumMoney(other.map((c) => c.totalReceived)),
      commissionOutstanding: sumMoney(other.map((c) => max0(c.totalOutstanding))),
    };
  });
  const buckets = [
    [0, 30, '未来30天'],
    [31, 60, '第31—60天'],
    [61, 90, '第61—90天'],
    [91, Infinity, '90天以后'],
  ] as const;
  return {
    summary: {
      signed: sumMoney(business.map((c) => c.amount)),
      contractReceived:sumMoney(business.map(c=>c.totalReceived)),
      invoiceReceived:unmatchedInvoiceCount?null:invoiceKnownReceived,invoiceKnownReceived,
      unpaid: sumMoney(business.map((c) => max0(c.totalOutstanding))),
      invoiced: sumMoney(businessInvoices.map((i) => i.amount)),
      invoiceUnpaid: unmatchedInvoiceCount ? null : invoiceKnownUnpaid,
      invoiceKnownUnpaid,
      construction: sumMoney(business.filter((c) => constructionIds.has(c.id)).map((c) => c.amount)),
      commission: sumMoney(cohort.filter(commission).map((c) => c.amount)),
      commissionUnpaid: sumMoney(cohort.filter(commission).map((c) => max0(c.totalOutstanding))),
      contractCount: business.length,
      unmatchedInvoiceCount,
      inconsistentPlanCount,
      unclassifiedCount: cohort.filter((c) => !trades.has(c.id)).length,
    },
    contracts: pageRows(
      financialRows.filter((r) =>
        q.metric === 'commission'
          ? r.category === 'software_commission'
          : r.category === 'business' &&
            (q.metric==='contractReceived'?d(r.received).gt(0):q.metric==='invoiceReceived'?(r.invoiceReceived===null||d(r.invoiceReceived).gt(0)):q.metric === 'unpaid'
              ? d(r.outstandingAmount).gt(0)
              : q.metric === 'invoiced'
                ? d(r.invoiced).gt(0)
                : q.metric === 'invoiceUnpaid'
                  ? invoiceBalances.some(
                      (i) => i.contractId === r.id && (i.outstanding === null || d(i.outstanding).gt(0)),
                    )
                  : q.metric === 'construction'
                    ? r.building
                    : true),
      ),
      q,
    ),
    channels,
    cashProjection: {
      rulesVersion: '1.0',
      total: sumMoney(projection.map((p) => p.amount)),
      weighted: sumMoney(projection.map((p) => p.weighted)),
      buckets: buckets.map(([start, end, name]) => {
        const rows = projection.filter((p) => {
          const delta = Math.round((Date.parse(p.expectedDate) - q.today.getTime()) / 86400000);
          return delta >= start && delta <= end;
        });
        return {
          name,
          count: rows.length,
          amount: sumMoney(rows.map((r) => r.amount)),
          weighted: sumMoney(rows.map((r) => r.weighted)),
        };
      }),
      details: pageRows(projection, q),
    },
    notices: [
      '合同按所选签约日期及负责人筛选；开票、已收和余额为这批合同截至当前累计，不是历史期末快照。',
      '我方业务合同含渠道作为甲方支付的实施、开发和外包款；明确的软件返佣单列，不计业务业绩。未分类合同暂按业务统计并标出待核数量。',
      '建设中金额取可见的在建/暂停项目所关联合同，每份合同只计一次，已完成、运维及关闭项目不纳入。',
      '已开票待收款按有效销项发票关联分期核销计算；关联不完整时显示待核实，不推定全部未收。',
      '回款权重是可解释的初始规则假设，未经历史统计校准；预计日期是推进安排，不是客户承诺。仅分配合同待收款，不再加开票余额，软件返佣不混入。',
    ],
  };
}
