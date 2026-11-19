import { Prisma } from '@prisma/client';
import {
  businessReport,
  type BusinessContract,
  type BusinessPlan,
  type BusinessProject,
  type BusinessInvoice,
} from './business-report-policy';
import { reportQuery, forecastReport } from './analytics-policy';
import { ownTradeAmount } from './trade-policy';
import { salesAmountProjection } from './sales-intake-policy';
const D = (v: number | string) => new Prisma.Decimal(v),
  date = (v: string) => new Date(v);
const q = () => reportQuery({ from: '2026-01-01', to: '2026-12-31' }, date('2026-11-15T00:00:00Z'));
const contract = (id: number, extra: Partial<BusinessContract> = {}): BusinessContract => ({
  id,
  contractNo: 'S' + id,
  name: 'Synthetic ' + id,
  customerId: 1,
  ownerId: 1,
  amount: D(1000),
  currency: 'CNY',
  status: 'signed',
  signDate: date('2026-01-01'),
  totalReceived: D(400),
  totalOutstanding: D(600),
  ...extra,
});
const plan = (id: number, extra: Partial<BusinessPlan> = {}): BusinessPlan => ({
  id,
  contractId: 1,
  amount: D(600),
  receivedAmount: D(0),
  outstandingAmount: D(600),
  dueDate: date('2026-11-30'),
  status: 'pending',
  invoiceId: 1,
  ...extra,
});
const invoice = (id: number, extra: Partial<BusinessInvoice> = {}): BusinessInvoice => ({
  id,
  contractId: 1,
  amount: D(600),
  direction: 'output',
  status: 'invoiced',
  ...extra,
});
const project = (id: number, extra: Partial<BusinessProject> = {}): BusinessProject => ({
  id,
  contractId: 1,
  name: 'Synthetic delivery',
  status: 'active',
  stage: 'testing',
  plannedEndDate: date('2026-12-01'),
  acceptanceState: 'not_requested',
  ...extra,
});
const customers = new Map([
  [1, { name: 'Synthetic channel payor', customerCategory: 'sales_channel', channelBrand: '用友' }],
]);
const commission = {
  category: 'software_commission' as const,
  originalAmount: '1000.00',
  reason: 'Synthetic confirmed commission',
  sourceIds: ['synthetic'],
  recordedAt: '2026-11-15T00:00:00Z',
  recordedBy: 1,
};
describe('business cash metrics with explicit trade nature', () => {
  it('includes services bought by a channel payor, excludes only confirmed software commission', () => {
    const r = businessReport(
      [contract(1), contract(2)],
      [plan(1)],
      [invoice(1)],
      [project(1), project(2)],
      new Map([[2, commission]]),
      customers,
      q(),
    );
    expect(r.summary).toMatchObject({
      signed: '1000.00',contractReceived:'400.00',invoiceReceived:'0.00',
      unpaid: '600.00',
      invoiced: '600.00',
      invoiceUnpaid: '600.00',
      construction: '1000.00',
      commission: '1000.00',
      commissionUnpaid: '600.00',
    });
    expect(r.channels[0]).toMatchObject({ amount: '1000.00', received: '400.00', commission: '1000.00' });
    expect(r.cashProjection.total).toBe('600.00');
    expect(r.cashProjection.details.items[0].expectedDate).toBe('2026-12-15');
    expect(r.cashProjection.details.items[0].weight).toBe(80);
  });
  it('deducts only matched installment receipts from invoices and flags incomplete allocation', () => {
    const r = businessReport(
      [contract(1)],
      [
        plan(1, { receivedAmount: D(200), outstandingAmount: D(400) }),
        plan(2, { amount: D(200), outstandingAmount: D(200), invoiceId: null }),
      ],
      [invoice(1), invoice(2, { amount: D(50) })],
      [],
      new Map(),
      customers,
      q(),
    );
    expect(r.summary.invoiceKnownReceived).toBe('200.00');expect(r.summary.invoiceReceived).toBeNull();
    expect(r.summary.invoiceKnownUnpaid).toBe('400.00');
    expect(r.summary.invoiceUnpaid).toBeNull();
    expect(r.summary.unmatchedInvoiceCount).toBe(1);
    expect(r.cashProjection.total).toBe('600.00');
  });
  it('uses signed CNY cohort and current balances, with no duplicate construction/void invoice amounts', () => {
    const rows = [
      contract(1),
      contract(2, { status: 'draft' }),
      contract(3, { signDate: date('2025-01-01') }),
      contract(4, { currency: 'USD' }),
    ];
    const before = JSON.stringify(rows);
    const r = businessReport(
      rows,
      [plan(1)],
      [invoice(1), invoice(2, { status: 'voided' }), invoice(3, { direction: 'input' })],
      [project(1, { status: 'completed' })],
      new Map(),
      customers,
      q(),
    );
    expect(r.summary.signed).toBe('1000.00');
    expect(r.summary.construction).toBe('0.00');
    expect(r.summary.invoiced).toBe('600.00');
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('falls back once to the contract balance when plans are inconsistent, with a visible reason', () => {
    const r = businessReport(
      [contract(1)],
      [plan(1, { outstandingAmount: D(900) })],
      [],
      [],
      new Map(),
      customers,
      q(),
    );
    expect(r.cashProjection.total).toBe('600.00');
    expect(r.summary.inconsistentPlanCount).toBe(1);
    expect(r.cashProjection.details.items[0].planId).toBeNull();
  });
  it('uses exact own amounts, invalidates decomposition after a quote change and preserves original quote', () => {
    const row = {
      amount: D(283200),
      probability: 50,
      healthFactors: {
        tradeClassification: {
          category: 'business',
          ownAmount: '107800',
          vendorProductAmount: '175400',
          originalAmount: '283200',
        },
      },
    };
    expect(ownTradeAmount(row)?.toFixed(2)).toBe('107800.00');
    expect(ownTradeAmount({ ...row, amount: D(300000) })).toBeNull();
    expect(salesAmountProjection(row)).toMatchObject({
      projectQuoteAmount: '283200.00',
      vendorProductAmount: '175400',
    });
    expect(row.amount.toFixed(2)).toBe('283200.00');
  });
  it('counts actual won amounts even if open-proposal forecast eligibility was disabled', () => {
    const r = forecastReport(
      [
        {
          id: 1,
          name: 'Synthetic signed',
          ownerId: 1,
          stage: 'won',
          status: 'won',
          amount: D(1000),
          expectedCloseDate: null,
          closedAt: date('2026-01-01'),
          nextAction: null,
          nextActionDate: null,
          healthFactors: { salesIntake: { forecastEligible: false, amountKnown: true } },
        },
      ],
      [],
      q(),
    );
    expect(r.summary.won).toBe('1000.00');
  });
});
