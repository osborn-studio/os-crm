import { z } from 'zod';
export const knowledgeKinds = ['product', 'price', 'project', 'meeting', 'outsourcing'] as const;
const source = z
  .object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(300),
    location: z.string().max(2000),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const knowledgeEntry = z
  .object({
    key: z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/),
    kind: z.enum(knowledgeKinds),
    title: z.string().min(1).max(200),
    customerId: z.number().int().positive().nullable(),
    summary: z.string().min(1).max(12000),
    evidenceStatus: z.enum(['verified_source', 'historical', 'proposed', 'pending']),
    sources: z.array(source).min(1).max(100),
    content: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 120000, '内容过长'),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((r, c) => {
    if (
      (['project', 'outsourcing'].includes(r.kind) ||
        (r.kind === 'meeting' && r.content.associationStatus !== 'unassigned')) &&
      !r.customerId
    )
      c.addIssue({ code: 'custom', message: '客户资料必须关联当前公司客户', path: ['customerId'] });
  });
export const knowledgeBatch = z
  .object({ requestKey: z.string().min(1).max(80), entries: z.array(knowledgeEntry).min(1).max(50) })
  .strict()
  .superRefine((v, c) => {
    if (new Set(v.entries.map((e) => e.key)).size !== v.entries.length)
      c.addIssue({ code: 'custom', message: '同批来源键重复' });
  });
export const knowledgeCommit = z
  .object({
    requestKey: z.string().min(1).max(80),
    previewId: z.string().uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    confirm: z.literal(true),
  })
  .strict();
const planDay = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      v >= '2010-01-01' &&
      v <= '2060-12-31' &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
export const knowledgeActivities = z
  .object({
    requestKey: z.string().min(1).max(80),
    items: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/),
            expectedVersion: z.number().int().positive(),
            targetType: z.enum(['customer', 'opportunity', 'lead']),
            targetId: z.number().int().positive(),
            targetVersion: z.string().datetime().optional(),
            amountPending: z.boolean().optional(),
            followup: z
              .object({ content: z.string().min(1).max(10000), occurredAt: z.string().datetime().nullable() })
              .strict()
              .optional(),
            action: z
              .object({
                title: z.string().min(1).max(200),
                content: z.string().min(1).max(5000),
                dueDate: planDay,
                priority: z.enum(['high', 'medium', 'low']),
              })
              .strict()
              .optional(),
          })
          .strict()
          .refine((v) => !!v.followup || !!v.action, '至少选择跟进或行动')
          .refine(
            (v) => !v.amountPending || (v.targetType === 'opportunity' && !!v.targetVersion),
            '金额待核须指定商机当前版本',
          ),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .refine((v) => new Set(v.items.map((x) => x.key)).size === v.items.length, '来源键重复');
