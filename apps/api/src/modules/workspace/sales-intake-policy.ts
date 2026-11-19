import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {Prisma} from '@prisma/client';
import {ownTradeAmount,currentTrade} from './trade-policy';
const key = z
  .string()
  .min(1)
  .max(90)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const day = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      v >= '2010-01-01' &&
      v <= '2060-12-31' &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const stamp = z.string().datetime();
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
const sources = z.array(z.string().min(1).max(1000)).min(1).max(100);
const customer = z
  .object({
    key,
    name: z.string().min(1).max(200),
    existingId: z.number().int().positive().optional(),
    expectedUpdatedAt: stamp.optional(),
    channel: z.enum(['direct', '用友', '钉钉', '阿里', '其他']),
    customerCategory:z.enum(['direct','sales_channel']).optional(),
    identityStatus: z.string().max(100),
    notes: z.string().max(3000),
  })
  .strict();
const draft = z
  .object({
    name: z.string().min(1).max(200),
    signingCompany: z.string().min(1).max(200),
    type: z.enum([
      'other',
      'implementation',
      'outsource',
      'ai_fde',
      'maintenance',
      'software_sale',
      'saas_sub',
      'channel',
    ]),
    taxRate: z.number().min(0).max(100),
    paymentTerms: z.string().max(200),
    remark: z.string().max(3000),
    items: z
      .array(
        z
          .object({
            name: z.string().min(1).max(200),
            manDays: z.number().positive().max(100000),
            unitPrice: money,
            amount: money,
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
const quoteVersion = z
  .object({
    amount: money,
    sourceId: z.string().min(1).max(1000),
    sourceDate: day.nullable(),
    basis: z.string().min(1).max(1500),
  })
  .strict();
const item = z
  .object({
    key,
    customerKey: key,
    name: z.string().min(1).max(200),
    kind: z.enum(['lead', 'quote', 'contract']),
    amount: money.nullable(),
    amountBasis: z.string().max(1500),
    forecastEligible: z.boolean(),
    outcome: z.enum(['open', 'won', 'lost']),
    ownerId: z.number().int().positive().optional(),
    contractId: z.number().int().positive().optional(),
    contractVersion: stamp.optional(),
    payerCustomerId: z.number().int().positive().optional(),
    sourceDate: day.nullable(),
    sourceIds: sources,
    notes: z.string().max(5000),
    nextAction: z.string().max(200),
    lossReason: z.string().max(500).optional(),
    lossGroup: z.enum(['confirmed', 'identity_pending']).optional(),
    lossConfirmedAt: day.optional(),
    draft: draft.optional(),
    quoteVersions: z.array(quoteVersion).max(20).optional(),
  })
  .strict();
const followup = z
  .object({
    key,
    caseKey: key,
    kind: z.enum(['revision', 'communication']),
    occurredAt: stamp.nullable(),
    content: z.string().min(1).max(10000),
    sourceId: z.string().min(1).max(1000),
  })
  .strict();
const action = z
  .object({
    key,
    caseKey: key.optional(),
    customerKey: key.optional(),
    contractId: z.number().int().positive().optional(),
    contractVersion: stamp.optional(),
    ownerId: z.number().int().positive().optional(),
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(5000),
    dueDate: day.nullable(),
    priority: z.enum(['high', 'medium', 'low']),
    sourceIds: sources,
  })
  .strict();
export const salesManifestSchema = z
  .object({
    batchKey: key,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    customers: z.array(customer).min(1).max(200),
    cases: z.array(item).min(1).max(200),
    followups: z.array(followup).max(500),
    actions: z.array(action).max(500),
    archiveIds: z.array(z.string().uuid()).max(50),
  })
  .strict()
  .superRefine((m, ctx) => {
    const unique = (rows: { key: string }[], label: string) => {
      if (new Set(rows.map((r) => r.key)).size !== rows.length)
        ctx.addIssue({ code: 'custom', message: label + '来源键重复' });
    };
    unique(m.customers, '客户');
    const proposed = m.customers
      .filter((c) => !c.existingId)
      .map((c) => c.name.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase());
    if (new Set(proposed).size !== proposed.length) ctx.addIssue({ code: 'custom', message: '新客户法定名称重复' });
    unique(m.cases, '事项');
    unique(m.followups, '跟进');
    unique(m.actions, '行动');
    const customers = new Set(m.customers.map((c) => c.key)),
      cases = new Set(m.cases.map((c) => c.key));
    for (const c of m.customers)
      if (!!c.existingId !== !!c.expectedUpdatedAt) ctx.addIssue({ code: 'custom', message: '沿用客户须提供当前版本' });
    for (const c of m.cases) {
      if (!customers.has(c.customerKey)) ctx.addIssue({ code: 'custom', message: '事项客户来源不存在' });
      if (c.outcome === 'lost' && (c.kind === 'lead' || !c.lossReason || !c.lossGroup || !c.lossConfirmedAt))
        ctx.addIssue({ code: 'custom', message: '丢单缺商务证据或原因确认' });
      if (c.outcome === 'won' && (!c.contractId || !c.contractVersion))
        ctx.addIssue({ code: 'custom', message: '成交须沿用有效合同' });
      if (c.contractId && !c.contractVersion) ctx.addIssue({ code: 'custom', message: '关联合同缺版本' });
      if (
        c.draft &&
        (c.kind !== 'contract' || c.contractId || c.amount === null || Number(c.amount) <= 0 || c.outcome !== 'open')
      )
        ctx.addIssue({ code: 'custom', message: '新合同仅按明确正金额创建未签草稿' });
      if (
        c.quoteVersions?.length &&
        (c.kind === 'lead' || c.amount === null || Number(c.quoteVersions.at(-1)!.amount) !== Number(c.amount))
      )
        ctx.addIssue({ code: 'custom', message: '报价末版必须对应当前已知商机金额' });
      if (c.draft) {
        const total = c.draft.items.reduce((n, r) => n + Math.round(Number(r.amount) * 100), 0);
        if (
          total !== Math.round(Number(c.amount) * 100) ||
          c.draft.items.some(
            (r) => Math.round(r.manDays * Number(r.unitPrice) * 100) !== Math.round(Number(r.amount) * 100),
          )
        )
          ctx.addIssue({ code: 'custom', message: '合同明细与总额不一致' });
      }
      if (c.amount === null && c.forecastEligible)
        ctx.addIssue({ code: 'custom', message: '未知金额不能计入金额预测' });
    }
    for (const f of m.followups) if (!cases.has(f.caseKey)) ctx.addIssue({ code: 'custom', message: '跟进事项不存在' });
    for (const a of m.actions)
      if (
        (a.caseKey && !cases.has(a.caseKey)) ||
        (a.customerKey && !customers.has(a.customerKey)) ||
        (!a.caseKey && !a.customerKey && !a.contractId) ||
        (a.contractId && !a.contractVersion)
      )
        ctx.addIssue({ code: 'custom', message: '行动来源或合同版本无效' });
  });
export type SalesManifest = z.infer<typeof salesManifestSchema>;
export function parseSalesManifest(input: unknown): SalesManifest {
  const r = salesManifestSchema.safeParse(input);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? '销售资料无效');
  return r.data;
}
export const intakeHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function salesIntakeMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const r = (value as Record<string, unknown>).salesIntake;
  return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
}
/** SQL Decimal's zero placeholder is never exposed as a known price. Metadata preserves unknown/basis. */
export function knownSalesAmount(row: { healthFactors?: unknown; amount?:Prisma.Decimal.Value }) {
  return salesIntakeMeta(row.healthFactors).amountKnown !== false && (row.amount===undefined || ownTradeAmount({...row,amount:row.amount})!==null);
}
export function salesForecastEligible(row: { healthFactors?: unknown; amount?:Prisma.Decimal.Value }) {
  return knownSalesAmount(row) && (row.amount===undefined||currentTrade({...row,amount:row.amount}).category!=='software_commission') && salesIntakeMeta(row.healthFactors).forecastEligible !== false;
}
export function salesAmountProjection<T extends Record<string, unknown>>(row: T): T {
  if (Object.hasOwn(row, 'healthFactors') && !knownSalesAmount(row))
    return { ...row, amount: null, weightedAmount: null, amountStatus: '待确认金额' };
  if(Object.hasOwn(row,'healthFactors')&&row.amount!==undefined&&row.amount!==null){
    const original=new Prisma.Decimal(String(row.amount)),trade=currentTrade({healthFactors:row.healthFactors,amount:original});
    if(trade.category){const own=ownTradeAmount({healthFactors:row.healthFactors,amount:original});return {...row,projectQuoteAmount:original.toFixed(2),vendorProductAmount:trade.vendorProductAmount??'0.00',tradeCategory:trade.category,amountBasis:trade.reason,amount:own,weightedAmount:own!==null&&typeof row.probability==='number'?own.mul(row.probability).div(100).toDecimalPlaces(2):null};}
  }
  return row;
}
