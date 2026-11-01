import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Actor } from '../../common/types/actor';
import { admin, hasPermission } from '../workspace/access';
import { id, text } from '../workspace/command-runner';

export function transferInput(body: Record<string, unknown>) {
  if (Object.keys(body).some((k) => !['requestKey', 'expectedUpdatedAt', 'targetUserId', 'reason'].includes(k)))
    throw new BadRequestException('转审仅接受目标人员、版本及原因');
  return { targetUserId: id(body.targetUserId), reason: text(body.reason, '转审原因', 1000) };
}
export function requireTransfer(
  actor: Actor,
  approval: { status: string; currentNodeId: number | null; applicantId: number; activeOrder?: number },
  node: { id: number; action: string; approverId: number; nodeOrder?: number },
) {
  if (approval.status !== 'pending' || node.action !== 'pending')
    throw new BadRequestException('只能转交待处理的审批节点');
  if (
    !admin(actor) &&
    (node.approverId !== actor.userId ||
      (approval.currentNodeId !== node.id &&
        (approval.activeOrder === undefined || approval.activeOrder !== node.nodeOrder)) ||
      !hasPermission(actor, 'approval:approve') ||
      !hasPermission(actor, 'approval:reject'))
  )
    throw new ForbiddenException('仅当前审批人可转审；管理员可恢复未完成节点');
  if (approval.applicantId === actor.userId && !admin(actor)) throw new ForbiddenException('申请人不能代办转审');
}
export function pageCursor(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) throw new BadRequestException('分页游标无效');
  return id(Number(value));
}
