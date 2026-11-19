import { z } from 'zod';
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
export const projectRegisterBody = z
  .object({
    requestKey: z.string().min(1).max(80),
    contracts: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            expectedUpdatedAt: z.string().datetime(),
            stage: z.enum(['initiation', 'blueprint', 'development', 'testing', 'go_live', 'acceptance']),
            plannedEndDate: day,
            reason: z.string().trim().min(10).max(3000),
            sourceIds: z.array(z.string().min(1).max(1000)).min(1).max(30),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
