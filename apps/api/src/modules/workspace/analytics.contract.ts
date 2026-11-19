import type { Actor } from '../../common/types/actor';
import { statisticsProperties } from './statistics-scope';
import { hasPermission } from './access';
import { reportSortFields } from './workspace-sort';
const inputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    year: { type: 'integer', minimum: 2010, maximum: 2060 },
    from: { type: 'string', format: 'date', description: 'Inclusive first business day,2010-01-01..2060-12-31; provide to together' },
    to: { type: 'string', format: 'date', description: 'Inclusive last business day,2010-01-01..2060-12-31' },
    month: { type: 'integer', minimum: 0, maximum: 12 },
    ...statisticsProperties,
    contractId: { type: 'integer', minimum: 1, maximum: 2147483647 },
    page: { type: 'integer', minimum: 1, maximum: 1000000 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    source: { enum: ['managed', 'legacy'] },
    detail: { enum: ['contracts', 'plans', 'receipts', 'balances', 'overdue'] },
    bucket: { enum: ['open', 'won', 'lost', 'closed', 'undated'] },
    metric:{enum:['contracts','contractReceived','invoiceReceived','unpaid','invoiced','invoiceUnpaid','construction','commission','projection']},sortBy:{enum:reportSortFields},sortOrder:{enum:['asc','desc']},
  },
};
export const analyticsCapabilities = [
  {id:'report.business.cash',description:'按签约合同归期读取我方业务合同、未收、开票、在建金额，渠道甲方往来与单列软件返佣，附可解释规则回款安排。',version:'1.0',permission:'finance:read',additionalPermissions:['contract:read'],effect:'read',endpoint:'GET /analytics/business',inputSchema},
  {
    id: 'report.sales.forecast',
    description: '读取当前权限下销售管道、阶段加权、赢单与明细；规则预测，不是AI销售承诺。',
    version: '1.0',
    permission: 'opportunity:read',
    effect: 'read',
    endpoint: 'GET /analytics/forecast',
    inputSchema,
  },
  {
    id: 'report.cash.collections',
    description: '读取当前权限下回款计划、实收、未收/逾期/账龄与明细；不执行财务写入。',
    version: '1.0',
    permission: 'finance:read',
    effect: 'read',
    endpoint: 'GET /analytics/collections',
    inputSchema,
    additionalPermissions: ['contract:read'],
  },
].map((c) => ({
  ...c,
  outputSchema: { type: 'object', required: c.id==='report.business.cash'?['version','generatedAt','summary','contracts','channels','cashProjection','notices']:['version', 'generatedAt', 'summary', 'monthly', 'notices'] },
  guards: [
    'authenticated tenant/actor',
    'role default; explicit person/company/department checked against current data scope',
    'object and record visibility',
    'RepeatableRead snapshot',
    'read-only; no state effect',
    'bounded query rejects truncation',
  ],
}));

export function allowedReportCapabilities(actor: Actor) {
  return analyticsCapabilities.filter(c => hasPermission(actor,c.permission) && (!('additionalPermissions' in c) || c.additionalPermissions?.every(p=>hasPermission(actor,p))));
}
