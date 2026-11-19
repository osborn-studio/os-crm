import { z } from 'zod';
const day = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(v => v >= '2010-01-01' && v <= '2060-12-31' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
export const contractPlanBody = z.object({requestKey:z.string().min(1).max(80),contracts:z.array(z.object({id:z.number().int().positive(),expectedUpdatedAt:z.string().datetime(),dueDate:day,nextAction:z.string().min(1).max(5000).optional(),sourceIds:z.array(z.string().min(1).max(1000)).min(1).max(100).optional()}).strict().refine(x=>!!x.nextAction===!!x.sourceIds,'具体行动须附来源')).min(1).max(100)}).strict().refine(b=>new Set(b.contracts.map(c=>c.id)).size===b.contracts.length,'合同不可重复');
export const actionCalendarBody=z.object({requestKey:z.string().min(1).max(80),items:z.array(z.object({id:z.number().int().positive(),expectedUpdatedAt:z.string().datetime(),startsAt:z.string().datetime({offset:true})}).strict()).min(1).max(100)}).strict().refine(b=>new Set(b.items.map(i=>i.id)).size===b.items.length,'行动不可重复');
export const salesActivityBody = z.object({
  requestKey: z.string().min(1).max(80),
  items: z.array(z.object({
    kind: z.enum(['opportunities','leads']), id: z.number().int().positive(), expectedUpdatedAt: z.string().datetime(),
    caseKey: z.string().min(1).max(90),
    identityStage: z.enum(['new','qualified']).optional(),
    expectedCloseDate: day.optional(), closeDateEstimated: z.boolean().optional(), dateBasis: z.string().min(1).max(1000),
    nextAction: z.string().min(1).max(200), nextActionDate: day,
    actionId: z.number().int().positive(), actionVersion: z.string().datetime(),
    followup: z.object({ content: z.string().min(1).max(10000), occurredAt: z.string().datetime(), estimated: z.boolean(), sourceIds: z.array(z.string().min(1).max(1000)).min(1).max(100) }).strict().optional(),
  }).strict().superRefine((r,c) => {
    if ((r.kind === 'leads' && r.expectedCloseDate) || (!!r.expectedCloseDate !== (r.closeDateEstimated !== undefined))) c.addIssue({code:'custom', message:'预计成交日期及估算标记不匹配'});
  })).min(1).max(100),
}).strict().superRefine((b,c) => {
  if (new Set(b.items.map(r=>r.kind+':'+r.id)).size!==b.items.length || new Set(b.items.map(r=>r.actionId)).size!==b.items.length) c.addIssue({code:'custom',message:'对象或行动不能重复'});
});
/** Imported events carry their actual source date; creation time is only a fallback for normal records. */
export function followupTime(row: { createdAt: Date; aiStructured: unknown }): Date | null {
  const raw = row.aiStructured;
  if (raw && typeof raw === 'object' && 'salesIntake' in raw) {
    const m = raw.salesIntake;
    if (m && typeof m === 'object' && 'occurredAt' in m) {
      const v = m.occurredAt;
      return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v) : null;
    }
  }
  return row.createdAt;
}
