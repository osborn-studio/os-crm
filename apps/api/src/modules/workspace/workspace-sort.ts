import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resource } from './registry';
const titles: Record<string, string> = {
  name: '名称',
  title: '标题',
  companyName: '客户名称',
  createdAt: '录入日期',
  updatedAt: '更新日期',
  lastFollowAt: '最近跟进日期',
  dueDate: '计划日期',
  expectedCloseDate: '预计成交日期',
  signDate: '签约日期',
  orderDate: '订单日期',
  invoiceDate: '开票日期',
  receiptDate: '收款日期',
  nextFollowAt: '下次跟进日期',
  plannedEndDate: '计划结束日期',
  amount: '金额',
  totalAmountInclTax: '含税金额',
  totalOutstanding: '合同未收',
  outstandingAmount: '计划未收',
  progress: '进度',
  listPrice: '目录价格',
  priority: '优先级',
  status: '状态',
};
const extras: Record<string, string[]> = {
  customers: ['lastFollowAt'],
  leads: ['lastFollowAt'],
  opportunities: ['expectedCloseDate', 'amount', 'lastFollowAt', 'status'],
  contracts: ['signDate', 'amount', 'totalOutstanding', 'status'],
  orders: ['orderDate', 'totalAmountInclTax', 'status'],
  projects: ['plannedEndDate', 'progress', 'status'],
  tasks: ['dueDate', 'status'],
  actions: ['dueDate', 'priority', 'status'],
  followups: ['nextFollowAt'],
  products: ['listPrice'],
  'payment-plans': ['dueDate', 'amount', 'outstandingAmount', 'status'],
  invoices: ['invoiceDate', 'amount', 'status'],
  receipts: ['receiptDate', 'amount', 'status'],
};
export function workspaceSortFields(kind: string) {
  const r = resource(kind),
    model = Prisma.dmmf.datamodel.models.find((m) => m.name[0].toLowerCase() + m.name.slice(1) === r.model);
  return [...new Set([r.name, 'createdAt', 'updatedAt', ...(extras[kind] ?? [])])]
    .filter((key) => model?.fields.some((f) => f.name === key && f.kind !== 'object'))
    .map((key) => ({ key, label: key==='dueDate'?(kind==='payment-plans'?'预计收款日':'计划完成日'):titles[key] ?? r.title + '编号' }));
}
export const defaultWorkspaceSort = (kind: string) =>
  kind === 'actions'
    ? { sortBy: 'dueDate', sortOrder: 'asc' as const }
    : { sortBy: 'createdAt', sortOrder: 'desc' as const };
export function workspaceOrderBy(kind: string, q: Record<string, string>) {
  const fallback = defaultWorkspaceSort(kind),
    sortBy = q.sortBy ?? fallback.sortBy,
    sortOrder = q.sortOrder ?? fallback.sortOrder;
  if (!workspaceSortFields(kind).some((f) => f.key === sortBy) || !['asc', 'desc'].includes(sortOrder))
    throw new BadRequestException('排序字段或方向无效');
  const r = resource(kind),
    model = Prisma.dmmf.datamodel.models.find((m) => m.name[0].toLowerCase() + m.name.slice(1) === r.model),
    field = model?.fields.find((f) => f.name === sortBy);
  return [{ [sortBy]: field && !field.isRequired ? { sort: sortOrder, nulls: 'last' } : sortOrder }, { id: sortOrder }];
}
export function compareSortValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;
  if (b === null || b === undefined || b === '') return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  const x = String(a),
    y = String(b);
  if (/^-?\d+(\.\d+)?$/.test(x) && /^-?\d+(\.\d+)?$/.test(y)) return new Prisma.Decimal(x).cmp(new Prisma.Decimal(y));
  if (/^\d{4}-\d{2}-\d{2}/.test(x) && /^\d{4}-\d{2}-\d{2}/.test(y)) {
    const aa = Date.parse(x),
      bb = Date.parse(y);
    if (Number.isFinite(aa) && Number.isFinite(bb)) return aa - bb;
  }
  return x.localeCompare(y, 'zh-CN', { numeric: true, sensitivity: 'base' });
}
export function sortBusinessRows<T>(rows: readonly T[], key: string, order: 'asc' | 'desc'): T[] {
  const empty = (x: unknown) => x === null || x === undefined || x === '';
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[key],
      bv = (b as Record<string, unknown>)[key];
    if (empty(av) || empty(bv)) return empty(av) && empty(bv) ? 0 : empty(av) ? 1 : -1;
    return (
      compareSortValues(av, bv) * (order === 'asc' ? 1 : -1) ||
      compareSortValues((a as Record<string, unknown>).id, (b as Record<string, unknown>).id) *
        (order === 'asc' ? 1 : -1)
    );
  });
}
export const reportSortFields = [
  'invoiceReceived','invoiceUnpaid',
  'expectedDate','invoiced','commission','weight','customerName','signDate','unpaid',
  'id',
  'name',
  'contractNo',
  'receiptNo',
  'planNo',
  'amount',
  'weighted',
  'expectedCloseDate',
  'closedAt',
  'dueDate',
  'receiptDate',
  'planned',
  'received',
  'currentOutstanding',
  'currentOverdue',
  'outstandingAmount',
  'receivedAmount',
  'status',
] as const;
