import { createHash } from 'node:crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import type { Tx } from './command-runner';
export const nameKey = (value: string) =>
  createHash('sha256').update(value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()).digest('hex');
export async function customerNames(tx: Tx, tenantId: number) {
  const rows = await tx.customer.findMany({ where: { tenantId }, select: { id: true, name: true } });
  return rows.map((r) => ({ id: r.id, key: nameKey(r.name) }));
}
export async function uniqueCustomer(tx: Tx, tenantId: number, name: string, except?: number) {
  // Covers legacy NULL fingerprints as well; no existing duplicate is silently merged.
  await tx.tenant.update({ where: { id: tenantId }, data: { updatedAt: new Date() } });
  if (except === undefined) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    if ((await tx.customer.count({ where: { tenantId, deletedAt: null } })) >= tenant.maxCustomers)
      throw new ConflictException('企业客户额度已达上限');
  }
  const key = nameKey(name);
  if ((await customerNames(tx, tenantId)).some((r) => r.id !== except && r.key === key))
    throw new ConflictException('客户名称已存在，请联系主管核对');
  return key;
}
export const importColumns = {
  客户名称: ['name', 200],
  行业: ['industry', 50],
  级别: ['level', 20],
  地区: ['region', 50],
  地址: ['address', 500],
  官网: ['website', 200],
  备注: ['remark', 3000],
} as const;
export type ImportData = {
  name: string;
  industry?: string;
  level?: string;
  region?: string;
  address?: string;
  website?: string;
  remark?: string;
};
export function parseCsv(csv: string): string[][] {
  if (Buffer.byteLength(csv) > 1024 * 1024) throw new BadRequestException('CSV上限1MiB');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    ended = false;
  const push = () => {
    row.push(field);
    field = '';
    ended = false;
    if (row.length > 7) throw new BadRequestException('CSV最多7列');
  };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          ended = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || ended) throw new BadRequestException('CSV引号位置无效');
      quoted = true;
    } else if (c === ',') push();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      push();
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      if (rows.length > 201) throw new BadRequestException('每次最多200条客户');
    } else {
      if (ended) throw new BadRequestException('CSV引号后只允许分隔符或换行');
      field += c;
    }
  }
  if (quoted) throw new BadRequestException('CSV引号未闭合');
  push();
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2 || rows.length > 201) throw new BadRequestException('需要表头及1—200条客户');
  return rows;
}
export function csvRecords(raw: string) {
  if (raw.includes('\uFFFD')) throw new BadRequestException('CSV存在无法解码的字符，请另存为UTF-8后重试');
  const [head, ...rows] = parseCsv(raw.replace(/^\uFEFF/, ''));
  const headers = head.map((v) => v.trim());
  if (
    !headers.includes('客户名称') ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !Object.hasOwn(importColumns, h))
  )
    throw new BadRequestException('表头需包含客户名称，且只能使用模板中的不重复列');
  return rows.map((values, index) => {
    const data: Record<string, string> = {};
    let error = values.length !== headers.length ? '列数与表头不一致' : '';
    for (const [i, header] of headers.entries()) {
      const [key, max] = importColumns[header as keyof typeof importColumns],
        value = (values[i] ?? '').trim();
      if (value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) error = `${header}超长或包含控制字符`;
      if (value) data[key] = value;
    }
    if (!data.name) error = '客户名称不能为空';
    if (data.level && !['重点客户', '普通客户', '潜在客户'].includes(data.level))
      error = '级别需为重点客户、普通客户或潜在客户';
    return { row: index + 2, data: data as ImportData, error };
  });
}
