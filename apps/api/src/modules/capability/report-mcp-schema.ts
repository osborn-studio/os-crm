import { z } from 'zod';
import {reportSortFields} from '../workspace/workspace-sort';
export const statisticsDate = z.string().regex(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/).refine(v => v >= '2010-01-01' && v <= '2060-12-31' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v);
export const reportMcpInput = z.object({
  sortBy:z.enum(reportSortFields).optional(),sortOrder:z.enum(['asc','desc']).optional(),metric:z.enum(['contracts','contractReceived','invoiceReceived','unpaid','invoiced','invoiceUnpaid','construction','commission','projection']).optional(),
  personRange: z.enum(['self','person','company','department']).optional(),
  from: statisticsDate.optional(),
  to: statisticsDate.optional(),
  year: z.number().int().min(2010).max(2060).optional(),
  month: z.number().int().min(0).max(12).optional(),
  ownerId: z.number().int().min(1).max(2147483647).optional(),
  deptId: z.number().int().min(1).max(2147483647).optional(),
  contractId: z.number().int().min(1).max(2147483647).optional(),
  page: z.number().int().min(1).max(1000000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  source: z.enum(['managed', 'legacy']).optional(),
  detail: z.enum(['contracts', 'plans', 'receipts', 'balances', 'overdue']).optional(),
  bucket: z.enum(['open', 'won', 'lost', 'closed', 'undated']).optional(),
}).strict();
