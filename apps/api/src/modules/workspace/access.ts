import { customerVisibility } from '../customer/customer-visibility';
import { ForbiddenException } from '@nestjs/common';
import type { Actor } from '../../common/types/actor';
import type { Tx } from './command-runner';
export const admin = (a: Actor) => a.roles.includes('super_admin');
export const boss = (a: Actor) => a.roles.includes('gm');
export const manager = (a: Actor) => a.roles.includes('sales_manager');
export const companyWide = (a: Actor) => admin(a) || boss(a) || a.dataScope === 'all';
/** A current department tree, never stale ownerDeptId labels. Cycles cannot broaden access. */
export function departmentSubtree(rows: readonly { id: number; parentId: number | null }[], root: number): number[] {
  if (!rows.some(d => d.id === root)) return [];
  const ids = new Set([root]);
  for (let changed = true; changed;) {
    changed = false;
    for (const d of rows) if (d.parentId !== null && ids.has(d.parentId) && !ids.has(d.id)) {
      ids.add(d.id); changed = true;
    }
  }
  return [...ids];
}
export async function teamDepartments(tx: Tx, a: Actor) {
  if (!['dept', 'team'].includes(a.dataScope) || a.deptId === null) return [];
  const rows = await tx.department.findMany({ where: { tenantId: a.tenantId, deletedAt: null }, select: { id: true, parentId: true } });
  return departmentSubtree(rows, a.deptId);
}
export function allowWrite(a: Actor) {
  if (!admin(a) && !manager(a) && !a.roles.includes('sales')) throw new ForbiddenException('当前角色无业务编辑权限');
}
export async function teamIds(tx: Tx, a: Actor) {
  if (!['dept', 'team'].includes(a.dataScope) || a.deptId === null) return [a.userId];
  return [...new Set([a.userId, ...(
    await tx.user.findMany({
      // Assets owned by inactive/resigned staff still belong to this department and need handover.
      where: { tenantId: a.tenantId, deptId: { in: await teamDepartments(tx, a) }, deletedAt: null },
      select: { id: true },
    })
  ).map((u) => u.id)])];
}
export async function ownerScope(tx: Tx, a: Actor, field = 'ownerId'): Promise<Record<string, unknown>> {
  if (companyWide(a)) return {};
  return { [field]: { in: await teamIds(tx, a) } };
}
export async function customerScope(tx: Tx, a: Actor, publicVisible = true) {
  return customerVisibility(a, await teamIds(tx, a), publicVisible);
}
export function hasPermission(a: Actor, permission: string) {
  return admin(a) || a.permissions.some((p) => p === '*' || p === permission || p === permission.split(':')[0] + ':*');
}
export function resourcePermission(kind: string, operation: 'read' | 'create' | 'update') {
  const modules: Record<string, string> = {
    customers: 'customer',
    contacts: 'customer',
    leads: 'lead',
    opportunities: 'opportunity',
    contracts: 'contract',
    orders: 'order',
    projects: 'project',
    tasks: 'project',
    actions: 'action',
    followups: 'follow_up',
    products: 'product',
    'payment-plans': 'finance',
    invoices: 'finance',
    receipts: 'finance',
  };
  return `${modules[kind] ?? 'unknown'}:${operation}`;
}
export function requirePermission(a: Actor, kind: string, operation: 'read' | 'create' | 'update') {
  if (!hasPermission(a, resourcePermission(kind, operation)))
    throw new ForbiddenException('当前角色没有此业务操作权限');
}
