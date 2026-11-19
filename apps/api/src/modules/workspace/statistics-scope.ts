import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Actor } from '../../common/types/actor';
import type { Tx } from './command-runner';
import { companyWide, teamIds, teamDepartments, departmentSubtree } from './access';

export function defaultStatisticsScope(a: Actor): { personRange: 'company' | 'department' | 'self'; deptId?: number } {
  if (companyWide(a)) return { personRange: 'company' };
  if (['dept', 'team'].includes(a.dataScope) && a.deptId !== null) return { personRange: 'department', deptId: a.deptId };
  return { personRange: 'self' };
}

export const statisticsProperties = {
  personRange: { enum: ['self', 'person', 'company', 'department'], description: 'Defaults to authorized company, department subtree, or self. Explicit filters never grant permission.' },
  ownerId: { type: 'integer', minimum: 1, maximum: 2147483647 },
  deptId: { type: 'integer', minimum: 1, maximum: 2147483647 },
};
export async function statisticsOptions(tx: Tx, a: Actor) {
  const owners = await tx.user.findMany({
    where: { tenantId: a.tenantId, deletedAt: null, ...(!companyWide(a) ? { id: { in: await teamIds(tx, a) } } : {}) },
    select: { id: true, name: true, deptId: true, employeeNo: true, status: true, roles:{select:{role:{select:{code:true}}}} }, orderBy: { id: 'asc' },
  });
  const departments = !companyWide(a) && !['dept','team'].includes(a.dataScope) ? [] : await tx.department.findMany({
    where:{tenantId:a.tenantId,deletedAt:null,...(!companyWide(a)?{id:{in:await teamDepartments(tx,a)}}:{})},select:{id:true,name:true,parentId:true,leaderId:true},
  });
  return {
    defaultRange: defaultStatisticsScope(a).personRange, defaultDeptId: defaultStatisticsScope(a).deptId ?? null, selfId: a.userId, canCompany: companyWide(a),
    owners:owners.map(({roles,...u})=>({...u,managedDepartmentIds:[...new Set([...departments.filter(d=>d.leaderId===u.id).map(d=>d.id),...(roles?.some(r=>r.role.code==='sales_manager') && u.deptId!==null && departments.some(d=>d.id===u.deptId)?[u.deptId]:[])])]})),
    departments,
  };
}
export interface StatisticsScope {
  personRange: 'self' | 'person' | 'company' | 'department';
  ownerIds: number[] | null;
}
export async function statisticsScope(tx: Tx, a: Actor, q: Record<string, string>): Promise<StatisticsScope> {
  const integer = (key: string) => {
    if (q[key] === undefined) return undefined;
    if (typeof q[key] !== 'string' || !/^[1-9]\d*$/.test(q[key]) || !Number.isSafeInteger(Number(q[key])) || Number(q[key]) > 2147483647)
      throw new BadRequestException(`${key}无效`);
    return Number(q[key]);
  };
  const ownerId = integer('ownerId');
  const defaults = defaultStatisticsScope(a);
  const range = q.personRange ?? (ownerId ? 'person' : q.deptId ? 'department' : defaults.personRange);
  const deptId = integer('deptId') ?? (q.personRange === undefined && !ownerId && range === 'department' ? defaults.deptId : undefined);
  if (!['self', 'person', 'company', 'department'].includes(range)) throw new BadRequestException('人员范围无效');
  if ((range !== 'person' && ownerId !== undefined) || (range !== 'department' && deptId !== undefined))
    throw new BadRequestException('人员范围与负责人/部门参数冲突');
  if (range === 'self') return { personRange: 'self', ownerIds: [a.userId] };
  if (range === 'company') {
    if (!companyWide(a)) throw new ForbiddenException('没有全公司统计数据权限');
    return { personRange: 'company', ownerIds: null };
  }
  if (range === 'person' && !ownerId || range === 'department' && !deptId) throw new BadRequestException('请选择人员或部门');
  if (range === 'department' && !companyWide(a) && !(await teamDepartments(tx, a)).includes(deptId!))
    throw new ForbiddenException('没有该部门统计数据权限');
  const options = await statisticsOptions(tx, a);
  if (range === 'person') {
    const selected=options.owners.find(u=>u.id===ownerId);
    if (!selected) throw new ForbiddenException('没有该人员统计数据权限');
    // Responsibility filtering is separate from record ownership. A manager selection
    // includes managed departments; selecting authenticated self remains strictly personal.
    const managed=new Set(selected.managedDepartmentIds.flatMap(root=>departmentSubtree(options.departments,root)));
    return { personRange:'person',ownerIds:options.owners.filter(u=>u.id===ownerId || u.deptId!==null && managed.has(u.deptId)).map(u=>u.id) };
  }
  if (!options.departments.some(d => d.id === deptId)) throw new ForbiddenException('没有该部门统计数据权限');
  const departments = new Set(departmentSubtree(options.departments, deptId!));
  return { personRange: 'department', ownerIds: options.owners.filter(u => u.deptId !== null && departments.has(u.deptId)).map(u => u.id) };
}
export function statisticsFilter(kind: string, scope: StatisticsScope, contractIds?: number[]): Record<string, unknown> {
  if (scope.ownerIds === null) return {};
  const selected = { in: scope.ownerIds };
  if (['customers', 'opportunities', 'contracts', 'orders'].includes(kind)) return { ownerId: selected };
  if (kind === 'receipts') {
    if (!contractIds) throw new BadRequestException('回款人员统计须先解析合同归属');
    return { contractId: { in: contractIds } };
  }
  if (['invoices', 'payment-plans'].includes(kind)) return { contract: { ownerId: selected } };
  if (kind === 'contacts') return { customer: { ownerId: selected } };
  if (kind === 'projects') return { OR: [{ salesOwnerId: selected }, { pmId: selected }] };
  if (['tasks', 'actions', 'leads'].includes(kind)) return { assigneeId: selected };
  if (kind === 'followups') {
    if (!contractIds) throw new BadRequestException('跟进统计须先解析客户归属');
    return { customerId: { in: contractIds } };
  }
  throw new BadRequestException('该对象不支持人员统计范围');
}
export async function statisticsResourceFilter(tx: Tx, a: Actor, kind: string, scope: StatisticsScope) {
  const contracts = kind === 'followups' && scope.ownerIds !== null
    ? await tx.customer.findMany({where:{tenantId:a.tenantId,deletedAt:null,ownerId:{in:scope.ownerIds}},select:{id:true}})
    : kind === 'receipts' && scope.ownerIds !== null
    ? await tx.contract.findMany({where:{tenantId:a.tenantId,deletedAt:null,ownerId:{in:scope.ownerIds}},select:{id:true}})
    : [];
  return statisticsFilter(kind, scope, contracts.map(c=>c.id));
}
