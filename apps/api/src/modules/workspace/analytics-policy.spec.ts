import {
  collectionReport,
  forecastReport,
  reportQuery,
  decimal,
  type ForecastRow,
  type PlanRow,
  type ReceiptRow,
  type ContractRow,
} from './analytics-policy';
const date = (s: string) => new Date(s);
const q = () => reportQuery({ year: '2026' }, date('2026-11-15T12:00:00Z'));
describe('explicit reporting date intervals',()=>{
  it('uses inclusive 2010 through 2060 business-day bounds',()=>{
    const r=reportQuery({from:'2010-01-01',to:'2060-12-31'});
    expect(r.start.toISOString()).toBe('2010-01-01T00:00:00.000Z');
    expect(r.end.toISOString()).toBe('2061-01-01T00:00:00.000Z');
    for(const bad of [{from:'2009-12-31',to:'2026-01-01'},{from:'2026-01-01',to:'2061-01-01'},{from:'2026-02-31',to:'2026-03-10'},{from:'2026-12-01',to:'2026-11-01'}])expect(()=>reportQuery(bad)).toThrow();
    expect(()=>reportQuery({from:'2026-01-01'})).toThrow();
  });
  it('does not merge identically numbered months in different years',()=>{
    const r=forecastReport([opp({id:1,amount:decimal(10),expectedCloseDate:date('2025-12-20')}),opp({id:2,amount:decimal(20),expectedCloseDate:date('2026-01-20')}),opp({id:3,amount:decimal(99),expectedCloseDate:date('2025-01-20')})],[stage],reportQuery({from:'2025-12-01',to:'2026-01-31'}));
    expect(r.monthly.map(m=>[m.year,m.month,m.amount])).toEqual([[2025,12,'10.00'],[2026,1,'20.00']]);
  });
});
const opp = (extra: Partial<ForecastRow> = {}): ForecastRow => ({
  id: 1,
  name: 'Synthetic',
  ownerId: 1,
  stage: 'proposal',
  status: 'open',
  amount: decimal('100.01'),
  expectedCloseDate: date('2026-11-30'),
  closedAt: null,
  nextAction: null,
  nextActionDate: null,
  ...extra,
});
const stage = { code: 'proposal', name: 'Proposal', probability: 50, isActive: true };
const contract: ContractRow = {
  id: 1,
  contractNo: 'TEST1',
  name: 'Synthetic',
  ownerId: 1,
  amount: decimal(100),
  currency: 'CNY',
  signDate: date('2026-01-01'),
  status: 'signed',
};
const plan = (extra: Partial<PlanRow> = {}): PlanRow => ({
  id: 1,
  planNo: 'P1',
  contractId: 1,
  amount: decimal(100),
  receivedAmount: decimal(40),
  outstandingAmount: decimal(60),
  dueDate: date('2026-10-16'),
  status: 'partial',
  ...extra,
});
const receipt = (extra: Partial<ReceiptRow> = {}): ReceiptRow => ({
  id: 1,
  receiptNo: 'R1',
  contractId: 1,
  amount: decimal(50),
  allocatedAmount: decimal(40),
  unallocatedAmount: decimal(10),
  receiptDate: date('2026-11-01'),
  status: 'confirmed',
  ledgerManaged: true,
  ...extra,
});
describe('analytics query admission', () => {
  it.each<Record<string, string>>([
    { year: '2026x' },
    { month: '13' },
    { ownerId: '0' },
    { pageSize: '101' },
    { tenantId: '2' },
    { source: 'all' },
    { year: '1999' },
    { page: '0' },
  ])('rejects malformed or identity-injecting input %j', (input) => expect(() => reportQuery(input)).toThrow());
  it('uses exclusive year end and explicit full-year month', () => {
    expect(q().end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(q().month).toBe(0);
  });
  it('admits leap February with no approximate day counts', () => {
    const r = reportQuery({ year: '2024', month: '2' });
    expect(r.end.toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });
});
describe('sales forecast accounting', () => {
  it('rounds each projected line to cents, not binary floats', () => {
    const r = forecastReport([opp(), opp({ id: 2 })], [stage], q());
    expect(r.summary.open).toBe('200.02');
    expect(r.summary.weighted).toBe('100.02');
  });
  it('separates open, won and lost and drills into the same cohort', () => {
    const rows = [
      opp(),
      opp({ id: 2, status: 'won', closedAt: date('2026-11-15') }),
      opp({ id: 3, status: 'lost', closedAt: date('2026-11-15') }),
    ];
    const r = forecastReport(rows, [stage], { ...q(), bucket: 'won' });
    expect(r.summary.openCount).toBe(1);
    expect(r.summary.winRate).toBe('50.0');
    expect(r.summary.won).toBe('100.01');
    expect(r.details.items.map((i) => i.id)).toEqual([2]);
  });
  it('keeps undated opportunities out of the chosen period and reports a separate pool', () => {
    const r = forecastReport([opp({ expectedCloseDate: null })], [stage], { ...q(), bucket: 'undated' });
    expect(r.summary.openCount).toBe(0);
    expect(r.summary.undatedCount).toBe(1);
    expect(r.details.meta.total).toBe(1);
    expect(r.summary.winRate).toBeNull();
  });
  it('does not silently assume probability for unknown or inactive stages', () => {
    const r = forecastReport([opp(), opp({ id: 2, stage: 'missing' })], [{ ...stage, isActive: false }], q());
    expect(r.summary.unweightedCount).toBe(2);
    expect(r.summary.weighted).toBe('0.00');
    expect(r.details.items[0].weighted).toBeNull();
  });
  it('does not treat valid zero probability as missing', () => {
    const r = forecastReport([opp()], [{ ...stage, probability: 0 }], q());
    expect(r.summary.unweightedCount).toBe(0);
    expect(r.summary.weighted).toBe('0.00');
  });
  it('uses Shanghai day at year boundary for closed timestamps', () => {
    const r = forecastReport([opp({ status: 'won', closedAt: date('2026-12-31T16:00:00Z') })], [stage], q());
    expect(r.summary.wonCount).toBe(0);
  });
  it('summary is independent of detail pagination', () => {
    const r = forecastReport([opp(), opp({ id: 2 })], [stage], { ...q(), sortBy:'id', sortOrder:'asc', pageSize: 1, page: 2 });
    expect(r.summary.openCount).toBe(2);
    expect(r.details.meta.total).toBe(2);
    expect(r.details.items[0].id).toBe(2);
  });
});
describe('cash, allocation and planned receipts', () => {
  it('never adds allocations to cash again', () => {
    const r = collectionReport([contract], [plan()], [receipt()], q());
    expect(r.summary.received).toBe('50.00');
    expect(r.summary.currentAllocatedOfReceipts).toBe('40.00');
    expect(r.summary.currentUnallocatedOfReceipts).toBe('10.00');
  });
  it('excludes draft and voided cash plus cancelled plans', () => {
    const r = collectionReport(
      [contract],
      [plan({ status: 'cancelled' })],
      [receipt({ status: 'draft' }), receipt({ id: 2, status: 'voided' })],
      q(),
    );
    expect(r.summary.received).toBe('0.00');
    expect(r.summary.planned).toBe('0.00');
    expect(r.summary.currentOutstanding).toBe('0.00');
  });
  it('uses separate due and receipt month, not signing month', () => {
    const r = collectionReport([contract], [plan()], [receipt()], q());
    expect(r.monthly[9].planned).toBe('100.00');
    expect(r.monthly[9].received).toBe('0.00');
    expect(r.monthly[10].received).toBe('50.00');
    expect(r.matrix.items[0].months[10].received).toBe('50.00');
  });
  it('keeps all-period stock separate from selected-period flow', () => {
    const r = collectionReport([contract], [plan()], [receipt()], {
      ...q(),
      start: date('2026-11-01'),
      end: date('2026-12-01'),
      month: 11,
    });
    expect(r.summary.planned).toBe('0.00');
    expect(r.summary.currentOutstanding).toBe('60.00');
    expect(r.summary.currentOverdue).toBe('60.00');
    expect(r.overdue.meta.total).toBe(1);
  });
  it('retains undated historical balances without inventing monthly plans or overdue age', () => {
    const r = collectionReport([contract], [plan({ dueDate: null })], [receipt()], q());
    expect(r.summary.currentOutstanding).toBe('60.00');
    expect(r.summary.currentOverdue).toBe('0.00');
    expect(r.summary.planned).toBe('0.00');
    expect(r.summary.received).toBe('50.00');
    expect(r.summary.undatedPlanCount).toBe(1);
    expect(r.summary.undatedOutstanding).toBe('60.00');
    expect(r.balances.items[0].dueDate).toBeNull();
    expect(r.aging.find(b => b.name === '日期待补')?.amount).toBe('60.00');
    expect(r.overdue.meta.total).toBe(0);
  });
  it.each([
    [0, 0],
    [1, 1],
    [30, 1],
    [31, 2],
    [60, 2],
    [61, 3],
    [90, 3],
    [91, 4],
  ])('places %i days overdue into bucket %i', (days, bucket) => {
    const r = collectionReport(
      [contract],
      [plan({ dueDate: new Date(q().today.getTime() - days * 86400000) })],
      [],
      q(),
    );
    expect(r.aging[bucket].amount).toBe('60.00');
    expect(r.summary.currentOverdue).toBe(days ? '60.00' : '0.00');
  });
  it('does not attribute unbound receipt cash to a contract', () => {
    const r = collectionReport([contract], [], [receipt({ contractId: null })], q());
    expect(r.summary.received).toBe('50.00');
    expect(r.summary.unboundReceived).toBe('50.00');
    expect(r.matrix.items[0].received).toBe('0.00');
  });
  it('handles receipt decimals exactly and excludes next-year dates', () => {
    const r = collectionReport(
      [],
      [],
      [
        receipt({ amount: decimal('0.1') }),
        receipt({ id: 2, amount: decimal('0.2') }),
        receipt({ id: 3, receiptDate: date('2027-01-01') }),
      ],
      q(),
    );
    expect(r.summary.received).toBe('0.30');
  });
});

describe('historical quote forecast semantics',()=>{
 it('excludes recurring and unknown totals across all monetary aggregates',()=>{
  const rows=[opp({id:11,amount:decimal(100)}),opp({id:12,amount:decimal(9000),healthFactors:{salesIntake:{amountKnown:true,forecastEligible:false}}}),opp({id:13,amount:decimal(0),healthFactors:{salesIntake:{amountKnown:false,forecastEligible:false}}})];
  const r=forecastReport(rows,[stage],q());
  expect(r.summary.open).toBe('100.00');expect(r.summary.weighted).toBe('50.00');expect(r.stages[0].amount).toBe('100.00');expect(r.owners[0].open).toBe('100.00');expect(r.monthly[10].amount).toBe('100.00');expect(r.details.items.find(x=>x.id===13)?.amount).toBeNull();expect(r.summary.unweightedCount).toBe(2);
 });
});
