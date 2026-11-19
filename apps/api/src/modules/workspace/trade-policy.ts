import { Prisma } from '@prisma/client';
import { z } from 'zod';
export const tradeProvider = 'crm-trade';
const money = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/);
export const tradeBody = z
  .object({
    requestKey: z.string().min(1).max(80),
    items: z
      .array(
        z
          .object({
            kind: z.enum(['contracts', 'opportunities']),
            id: z.number().int().positive(),
            expectedUpdatedAt: z.string().datetime(),
            category: z.enum(['business', 'software_commission']),
            ownAmount: money.nullable().optional(),
            vendorProductAmount: money.optional(),
            reason: z.string().trim().min(5).max(1500),
            sourceIds: z.array(z.string().min(1).max(1000)).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type TradeClassification = {
  category: 'business' | 'software_commission';
  ownAmount?: string | null;
  vendorProductAmount?: string;
  originalAmount: string;
  reason: string;
  sourceIds: string[];
  recordedAt: string;
  recordedBy: number;
};
export function tradeMeta(value: unknown): Partial<TradeClassification> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const trade = (value as Record<string, unknown>).tradeClassification;
  return trade && typeof trade === 'object' && !Array.isArray(trade) ? (trade as Partial<TradeClassification>) : {};
}
export function currentTrade(row: {
  healthFactors?: unknown;
  amount: Prisma.Decimal.Value;
}): Partial<TradeClassification> {
  const t = tradeMeta(row.healthFactors);
  if(t.originalAmount===undefined)return {};
  if(new Prisma.Decimal(t.originalAmount).eq(row.amount))return t;
  return {...t,ownAmount:t.category==='software_commission'?'0.00':null,reason:(t.reason??'')+'；原报价已变化，金额拆分待重新核实'};
}
/** Original quote/contract amount remains immutable. Unknown decomposition is not a zero quote. */
export function ownTradeAmount(row: { healthFactors?: unknown; amount: Prisma.Decimal.Value }): Prisma.Decimal | null {
  const t = currentTrade(row);
  if (t.category === 'software_commission') return new Prisma.Decimal(0);
  if (t.ownAmount === null) return null;
  return new Prisma.Decimal(t.ownAmount ?? row.amount);
}
