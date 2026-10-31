import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { object, text } from './command-runner';
export interface Field {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'reference';
  required?: boolean;
  options?: string[];
  reference?: string;
}
export interface Resource {
  model: string;
  title: string;
  name: string;
  fields: Field[];
  actions: string[];
  readonly?: boolean;
}
const f = (
  key: string,
  label: string,
  type: Field['type'] = 'text',
  required = false,
  extra: Partial<Field> = {},
): Field => ({ key, label, type, required, ...extra });
const customer = f('customerId', '客户', 'reference', true, { reference: 'customers' });
export const resources: Record<string, Resource> = {
  customers: {
    model: 'customer',
    title: '客户',
    name: 'name',
    fields: [
      f('name', '客户名称', 'text', true),
      f('industry', '行业'),
      f('level', '级别', 'select', false, { options: ['重点客户', '普通客户', '潜在客户'] }),
      f('region', '地区'),
      f('address', '地址'),
      f('website', '官网'),
      f('remark', '备注', 'textarea'),
    ],
    actions: ['claim', 'return', 'assign', 'follow'],
  },
  contacts: {
    model: 'contact',
    title: '联系人',
    name: 'name',
    fields: [customer, f('name', '姓名', 'text', true), f('title', '职务'), f('phone', '电话'), f('email', '邮箱')],
    actions: [],
  },
  leads: {
    model: 'lead',
    title: '线索',
    name: 'companyName',
    fields: [
      f('companyName', '企业名称', 'text', true),
      f('contactName', '联系人'),
      f('source', '来源', 'select', true, { options: ['website', 'referral', 'exhibition', 'partner', 'import'] }),
      f('industry', '行业'),
      f('demand', '需求', 'textarea'),
    ],
    actions: ['convert'],
  },
  opportunities: {
    model: 'opportunity',
    title: '商机与报价',
    name: 'name',
    fields: [
      f('name', '商机名称', 'text', true),
      customer,
      f('amount', '预计金额', 'money', true),
      f('expectedCloseDate', '预计成交日期', 'date'),
      f('demandSummary', '需求摘要', 'textarea'),
      f('nextAction', '下一步行动'),
    ],
    actions: ['advance', 'quote', 'lose'],
  },
  contracts: {
    model: 'contract',
    title: '合同',
    name: 'name',
    fields: [
      f('name', '合同名称', 'text', true),
      customer,
      f('opportunityId', '关联商机', 'reference', false, { reference: 'opportunities' }),
      f('contractType', '合同类型', 'select', true, {
        options: ['software_sale', 'implementation', 'maintenance', 'outsource', 'ai_fde', 'saas_sub', 'channel'],
      }),
      f('amount', '含税合同金额', 'money', true),
      f('taxRate', '税率%', 'number'),
      f('paymentTerms', '付款约定'),
      f('remark', '备注', 'textarea'),
    ],
    actions: ['submit', 'sign', 'order', 'project'],
  },
  orders: {
    model: 'order',
    title: '订单',
    name: 'orderNo',
    fields: [f('contractId', '合同', 'reference', true, { reference: 'contracts' }), f('remark', '备注', 'textarea')],
    actions: ['submit', 'confirm', 'deliver'],
  },
  projects: {
    model: 'project',
    title: '项目',
    name: 'name',
    fields: [
      f('name', '项目名称', 'text', true),
      customer,
      f('contractId', '关联合同', 'reference', false, { reference: 'contracts' }),
      f('plannedStartDate', '计划开始', 'date', true),
      f('plannedEndDate', '计划结束', 'date', true),
      f('budgetAmount', '项目预算', 'money'),
      f('remark', '备注', 'textarea'),
    ],
    actions: ['submit', 'start', 'advance', 'accept'],
  },
  tasks: {
    model: 'projectTask',
    title: '项目任务',
    name: 'title',
    fields: [
      f('title', '任务名称', 'text', true),
      f('projectId', '项目', 'reference', true, { reference: 'projects' }),
      f('dueDate', '截止日期', 'date'),
      f('description', '任务说明', 'textarea'),
    ],
    actions: ['complete'],
  },
  actions: {
    model: 'actionPlan',
    title: '行动计划',
    name: 'title',
    fields: [
      f('title', '行动名称', 'text', true),
      f('targetId', '客户', 'reference', true, { reference: 'customers' }),
      f('dueDate', '计划日期', 'date'),
      f('content', '内容', 'textarea'),
    ],
    actions: ['complete'],
  },
  followups: {
    model: 'followUp',
    title: '跟进记录',
    name: 'content',
    fields: [
      customer,
      f('content', '跟进内容', 'textarea', true),
      f('nextAction', '下一步'),
      f('nextFollowAt', '下次跟进', 'date'),
    ],
    actions: [],
  },
  products: {
    model: 'product',
    title: '产品目录',
    name: 'name',
    fields: [
      f('name', '产品名称', 'text', true),
      f('code', '编码', 'text', true),
      f('category', '分类'),
      f('unit', '单位'),
      f('listPrice', '目录单价', 'money'),
      f('taxRate', '税率%', 'number'),
    ],
    actions: [],
  },
  'payment-plans': { model: 'paymentPlan', title: '回款计划', name: 'planNo', fields: [], actions: [], readonly: true },
  invoices: { model: 'invoice', title: '发票', name: 'invoiceNo', fields: [], actions: [], readonly: true },
  receipts: { model: 'receipt', title: '收款记录', name: 'receiptNo', fields: [], actions: [], readonly: true },
};
export function resource(kind: string): Resource {
  const r = resources[kind];
  if (!r) throw new BadRequestException('不支持的业务对象');
  return r;
}
export function cleanInput(kind: string, value: unknown, partial = false): Record<string, unknown> {
  const input = object(value),
    spec = resource(kind),
    result: Record<string, unknown> = {};
  for (const key of Object.keys(input))
    if (!spec.fields.some((f) => f.key === key)) throw new BadRequestException(`不允许修改字段 ${key}`);
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name[0].toLowerCase() + m.name.slice(1) === spec.model);
  for (const field of spec.fields) {
    const v = input[field.key];
    if (v === undefined) {
      if (field.required && !partial) throw new BadRequestException(`请填写${field.label}`);
      continue;
    }
    if (v === null || v === '') {
      if (field.required) throw new BadRequestException(`请填写${field.label}`);
      if (partial) {
        if (model?.fields.find((f) => f.name === field.key)?.isRequired !== false)
          throw new BadRequestException(`${field.label}不可为空`);
        result[field.key] = null;
      }
      continue;
    }
    if (['text', 'textarea'].includes(field.type))
      result[field.key] = text(
        v,
        field.label,
        (
          {
            customers: { name: 200, industry: 50, level: 20, region: 50, address: 500, website: 200, remark: 3000 },
            leads: { companyName: 200, contactName: 50, industry: 50, demand: 3000 },
          } as Record<string, Record<string, number>>
        )[kind]?.[field.key] ?? (field.type === 'textarea' ? 3000 : field.key === 'code' ? 30 : 200),
      );
    if (field.type === 'money') {
      const s = String(v);
      if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) throw new BadRequestException(`${field.label}须为非负金额，最多两位小数`);
      result[field.key] = s;
    }
    if (field.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new BadRequestException(`${field.label}范围0—100`);
      result[field.key] = n;
    }
    if (field.type === 'reference') {
      if (!Number.isSafeInteger(v) || Number(v) < 1) throw new BadRequestException(`${field.label}编号无效`);
      result[field.key] = v;
    }
    if (field.type === 'select') {
      if (!field.options?.includes(String(v))) throw new BadRequestException(`${field.label}选项无效`);
      result[field.key] = v;
    }
    if (field.type === 'date') {
      if (
        typeof v !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v
      )
        throw new BadRequestException(`${field.label}日期无效`);
      result[field.key] = new Date(`${v}T00:00:00Z`);
    }
  }
  return result;
}
