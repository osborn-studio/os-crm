import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { object, text } from '../workspace/command-runner';
export interface FlowField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  required: boolean;
}
export interface FlowNodeInput {
  name: string;
  approverType: 'user' | 'role' | 'dept_leader';
  approverValue: string;
  condition: string;
}
export interface FlowInput {
  name: string;
  bizType: string;
  condition: string;
  priority: number;
  nodes: FlowNodeInput[];
  fields: FlowField[];
}
export function condition(expression: string, amount: Prisma.Decimal | string | number): boolean {
  if (expression === 'always' || expression === '') return true;
  const match = /^amount\s*(>=|<=|>|<|==)\s*(\d+(?:\.\d{1,2})?)$/.exec(expression);
  if (!match) throw new BadRequestException('条件仅支持 always 或 amount >= 200000 等金额比较');
  const left = new Prisma.Decimal(amount),
    right = new Prisma.Decimal(match[2]);
  return (
    { '>=': left.gte(right), '<=': left.lte(right), '>': left.gt(right), '<': left.lt(right), '==': left.eq(right) }[
      match[1]
    ] ?? false
  );
}
export function flowInput(value: unknown): FlowInput {
  const body = object(value);
  const name = text(body.name, '流程名称', 100);
  const bizType = text(body.bizType, '业务类型', 30);
  if (
    ![
      'general',
      'contract',
      'contract_change',
      'order',
      'project_initiation',
      'discount',
      'expense',
      'leave',
      'purchase',
    ].includes(bizType)
  )
    throw new BadRequestException('不支持的审批业务类型');
  const expression = typeof body.condition === 'string' ? body.condition.trim() : 'always';
  condition(expression, 0);
  if (!Array.isArray(body.nodes) || body.nodes.length < 1 || body.nodes.length > 12)
    throw new BadRequestException('流程需要1—12个节点');
  const nodes = body.nodes.map((value): FlowNodeInput => {
    const node = object(value),
      type = node.approverType;
    if (!['user', 'role', 'dept_leader'].includes(String(type))) throw new BadRequestException('审批人类型无效');
    const approverValue = type === 'dept_leader' ? '' : text(node.approverValue, '审批人', 100);
    const expression = typeof node.condition === 'string' ? node.condition.trim() : 'always';
    condition(expression, 0);
    return {
      name: text(node.name, '节点名称', 50),
      approverType: type as FlowNodeInput['approverType'],
      approverValue,
      condition: expression,
    };
  });
  const priority = Number(body.priority ?? 0);
  if (!Number.isInteger(priority) || priority < 0 || priority > 1000) throw new BadRequestException('优先级范围0—1000');
  const fields: FlowField[] = (Array.isArray(body.fields) ? body.fields : []).map((value) => {
    const f = object(value),
      key = text(f.key, '字段编码', 30);
    if (['flowSnapshot', 'businessSnapshot', 'amount'].includes(key))
      throw new BadRequestException('字段编码与系统审批证据保留字段冲突');
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(key) || !['text', 'number', 'date'].includes(String(f.type)))
      throw new BadRequestException('字段编码或类型无效');
    return {
      key,
      label: text(f.label, '字段名称', 50),
      type: f.type as FlowField['type'],
      required: f.required === true,
    };
  });
  if (fields.length > 20 || new Set(fields.map((f) => f.key)).size !== fields.length)
    throw new BadRequestException('字段重复或超过20个');
  return { name, bizType, condition: expression, priority, nodes, fields };
}
