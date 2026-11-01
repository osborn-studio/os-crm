import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Project } from '@prisma/client';
import type { Actor } from '../../common/types/actor';
import { admin } from './access';
import { type Tx, id, text } from './command-runner';
import { deliveryEvent } from './delivery-policy';

export async function deliveryPeople(tx: Tx, a: Actor, p: Project) {
  const pm = await tx.user.findFirst({ where: { tenantId: a.tenantId, id: p.pmId }, select: { deptId: true } });
  const deptId = a.roles.includes('sales_manager') ? a.deptId : pm?.deptId;
  if (!admin(a) && a.roles.includes('sales_manager') && (!deptId || pm?.deptId !== deptId))
    throw new ForbiddenException('主管只能交接本部门项目经理的交付工作');
  const users = await tx.user.findMany({
    where: {
      tenantId: a.tenantId,
      status: 'active',
      deletedAt: null,
      department: { tenantId: a.tenantId, status: 1, deletedAt: null },
      ...(!admin(a) ? (deptId ? { deptId } : { id: a.userId }) : {}),
    },
    include: { roles: { include: { role: true } } },
    orderBy: { id: 'asc' },
    take: 200,
  });
  return users
    .filter((u) => {
      const roles = u.roles.map((r) => r.role);
      const codes = roles.map((r) => r.code);
      const permissions = roles.flatMap((r) =>
        Array.isArray(r.permissions) ? r.permissions.filter((v): v is string => typeof v === 'string') : [],
      );
      return (
        codes.includes('super_admin') ||
        (codes.some((v) => ['sales_manager', 'sales'].includes(v)) &&
          ['project:read', 'project:update'].every((v) =>
            permissions.some((p) => p === v || p === '*' || p === 'project:*'),
          ))
      );
    })
    .map((u) => ({ id: u.id, name: u.name, deptId: u.deptId }));
}
export async function handoverProjectManager(tx: Tx, a: Actor, p: Project, body: Record<string, unknown>) {
  if (!admin(a) && !a.roles.includes('sales_manager')) throw new ForbiddenException('项目经理交接仅管理员或主管可执行');
  if (!['draft', 'rejected', 'active', 'on_hold'].includes(p.status) || p.acceptanceState === 'pending')
    throw new ConflictException('项目审批、验收处理中或已经关闭，不能交接');
  const recipient = (await deliveryPeople(tx, a, p)).find((u) => u.id === id(body.userId));
  if (!recipient || recipient.id === p.pmId) throw new BadRequestException('接收人不可用或没有实际变化');
  const note = text(body.note, '交接原因及待办说明', 3000);
  const openTaskWhere = {
    tenantId: a.tenantId,
    projectId: p.id,
    deletedAt: null,
    assigneeId: p.pmId,
    status: { notIn: ['done' as const, 'cancelled' as const] },
  };
  const latestTask = await tx.projectTask.aggregate({ where: openTaskWhere, _max: { updatedAt: true } });
  const moved = await tx.projectTask.updateMany({
    where: openTaskWhere,
    data: {
      assigneeId: recipient.id,
      updatedAt: new Date(Math.max(Date.now(), (latestTask._max.updatedAt?.getTime() ?? 0) + 1)),
    },
  });
  const milestones = await tx.projectMilestone.updateMany({
    where: { tenantId: a.tenantId, projectId: p.id, ownerId: p.pmId, status: { not: 'completed' } },
    data: { ownerId: recipient.id },
  });
  await tx.project.update({ where: { tenantId: a.tenantId, id: p.id }, data: { pmId: recipient.id } });
  await deliveryEvent(tx, a, p.id, 'project.pm_handover', note, {
    fromUserId: p.pmId,
    toUserId: recipient.id,
    toName: recipient.name,
    openTasksMoved: moved.count,
    milestonesMoved: milestones.count,
  });
}
