import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, type DeliveryEvent, type Project } from '@prisma/client';
import type { Actor } from '../../common/types/actor';
import { admin, manager } from './access';
import { id, json, text, type Tx } from './command-runner';

export function deliveryManager(a: Actor, project: Pick<Project, 'pmId'>) {
  if (!admin(a) && !manager(a) && project.pmId !== a.userId)
    throw new ForbiddenException('仅项目经理或有范围权限的主管可管理交付');
}
export function activeDelivery(project: Pick<Project, 'status' | 'actualStartDate' | 'acceptanceState'>) {
  if (project.status !== 'active' || !project.actualStartDate)
    throw new BadRequestException('项目审批激活并启动后才能执行交付');
  if (project.acceptanceState === 'pending') throw new ConflictException('验收处理中，需先拒收后整改');
}
export function taskHours(value: unknown): Prisma.Decimal {
  if (typeof value !== 'string' || !/^\d{1,4}(\.\d)?$/.test(value))
    throw new BadRequestException('实际工时需为0.1—9999.9的十进制字符串，最多1位小数');
  const hours = new Prisma.Decimal(value);
  if (hours.lte(0) || hours.gt('9999.9')) throw new BadRequestException('实际工时超出范围');
  return hours;
}
export async function deliveryEvent(
  tx: Tx,
  a: Actor,
  projectId: number,
  kind: string,
  note: string,
  evidence: unknown,
  taskId?: number,
) {
  const actor = await tx.user.findFirst({ where: { tenantId: a.tenantId, id: a.userId }, select: { name: true } });
  return tx.deliveryEvent.create({
    data: {
      tenantId: a.tenantId,
      projectId,
      actorId: a.userId,
      kind,
      note,
      evidence: json({
        ...(evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? evidence : { details: evidence }),
        actorName: actor?.name ?? '历史操作人',
      }),
      ...(taskId ? { taskId } : {}),
    },
  });
}
export async function taskProject(tx: Tx, a: Actor, projectId: number) {
  const project = await tx.project.findFirst({ where: { id: projectId, tenantId: a.tenantId, deletedAt: null } });
  if (!project) throw new BadRequestException('任务关联项目不可用');
  return project;
}
export async function validateTaskMilestone(tx: Tx, a: Actor, projectId: number, value: unknown) {
  if (value === null || value === undefined) return;
  const milestone = await tx.projectMilestone.findFirst({ where: { id: id(value), tenantId: a.tenantId, projectId } });
  if (!milestone || milestone.status === 'completed') throw new BadRequestException('里程碑不属于当前项目或已经完成');
}
export async function projectDeliveryCommand(
  tx: Tx,
  a: Actor,
  p: Project,
  action: string,
  body: Record<string, unknown>,
) {
  deliveryManager(a, p);
  const where = { id: p.id, tenantId: a.tenantId };
  const note = text(body.note, '交付结果/验收依据或整改说明', 3000);
  if (action === 'advance') {
    activeDelivery(p);
    const milestone = await tx.projectMilestone.findFirst({
      where: { tenantId: a.tenantId, projectId: p.id, status: { not: 'completed' } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    if (!milestone) throw new BadRequestException('里程碑已完成，请提交验收');
    const unfinished = await tx.projectTask.count({
      where: {
        tenantId: a.tenantId,
        projectId: p.id,
        deletedAt: null,
        status: { not: 'done' },
        OR: [{ milestoneId: milestone.id }, ...(milestone.stage === 'acceptance' ? [{ milestoneId: null }] : [])],
      },
    });
    if (unfinished) throw new ConflictException('当前里程碑尚有未完成任务');
    await tx.projectMilestone.update({
      where: { id: milestone.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        completedBy: a.userId,
        actualDate: new Date(),
        deliverables: note,
      },
    });
    const [total, done] = await Promise.all([
      tx.projectMilestone.count({ where: { tenantId: a.tenantId, projectId: p.id } }),
      tx.projectMilestone.count({ where: { tenantId: a.tenantId, projectId: p.id, status: 'completed' } }),
    ]);
    await tx.project.update({
      where,
      data: { progress: Math.round((done / total) * 100), stage: milestone.stage as Project['stage'] },
    });
    await deliveryEvent(tx, a, p.id, 'milestone.completed', note, {
      milestoneId: milestone.id,
      name: milestone.name,
      stage: milestone.stage,
    });
    return;
  }
  if (p.status !== 'active' || !p.actualStartDate) throw new BadRequestException('项目尚未启动或已经结束');
  if (action === 'request_acceptance') {
    if (p.acceptanceState === 'pending') throw new ConflictException('已提交验收');
    const [openMilestones, totalMilestones, openTasks] = await Promise.all([
      tx.projectMilestone.count({ where: { tenantId: a.tenantId, projectId: p.id, status: { not: 'completed' } } }),
      tx.projectMilestone.count({ where: { tenantId: a.tenantId, projectId: p.id } }),
      tx.projectTask.count({
        where: { tenantId: a.tenantId, projectId: p.id, deletedAt: null, status: { not: 'done' } },
      }),
    ]);
    if (!totalMilestones || openMilestones || openTasks)
      throw new ConflictException('全部里程碑和任务完成后才能提交验收');
    await tx.project.update({ where, data: { acceptanceState: 'pending', acceptanceSubmittedBy: a.userId } });
    await deliveryEvent(tx, a, p.id, 'acceptance.requested', note, {
      milestones: totalMilestones,
      progress: p.progress,
      attachments: await tx.evidenceAttachment.findMany({
        where: { tenantId: a.tenantId, subjectKind: 'projects', subjectId: p.id, withdrawnAt: null },
        select: { id: true, filename: true, sha256: true, size: true },
        orderBy: { id: 'asc' },
      }),
    });
    return;
  }
  if (!['accept', 'reject_acceptance'].includes(action)) throw new BadRequestException('不支持的交付操作');
  if (!admin(a) && !manager(a)) throw new ForbiddenException('验收决定需由有范围权限的主管或管理员处理');
  if (a.userId === p.pmId || a.userId === p.acceptanceSubmittedBy)
    throw new ForbiddenException('不能确认本人负责或提交的项目验收，请由另一位主管/管理员处理');
  if (p.acceptanceState !== 'pending') throw new ConflictException('请先提交项目验收');
  if (action === 'reject_acceptance') {
    await tx.project.update({ where, data: { acceptanceState: 'rejected' } });
    await deliveryEvent(tx, a, p.id, 'acceptance.rejected', note, { submittedBy: p.acceptanceSubmittedBy });
  } else {
    const open = await tx.projectTask.count({
      where: { tenantId: a.tenantId, projectId: p.id, deletedAt: null, status: { not: 'done' } },
    });
    const incomplete = await tx.projectMilestone.count({
      where: { tenantId: a.tenantId, projectId: p.id, status: { not: 'completed' } },
    });
    if (open || incomplete) throw new ConflictException('验收依据已变化，请拒收后重新提交');
    await tx.project.update({
      where,
      data: {
        status: 'completed',
        acceptanceState: 'accepted',
        progress: 100,
        stage: 'closed',
        acceptanceDate: new Date(),
        actualEndDate: new Date(),
        closureNote: note,
      },
    });
    await deliveryEvent(tx, a, p.id, 'acceptance.accepted', note, { submittedBy: p.acceptanceSubmittedBy });
  }
}
// Task completion events snapshot private task attachments. Project collaborators may read the
// project history without reading every task, so withhold that metadata unless the task is visible.
export function redactTaskEvidence<E extends Pick<DeliveryEvent, 'taskId' | 'evidence'>>(
  events: E[],
  visibleTaskIds: ReadonlySet<number>,
): E[] {
  return events.map((e) => {
    const evidence = e.evidence;
    if (e.taskId === null || visibleTaskIds.has(e.taskId) || !evidence || typeof evidence !== 'object') return e;
    if (Array.isArray(evidence) || !Array.isArray(evidence.attachments)) return e;
    return { ...e, evidence: { ...evidence, attachments: [], attachmentsWithheld: evidence.attachments.length } };
  });
}
