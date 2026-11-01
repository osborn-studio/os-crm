import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { ServiceTicket } from '@prisma/client';
export const ticketActions = ['assign', 'start', 'note', 'resolve', 'close', 'reopen', 'cancel'] as const;
export type TicketAction = (typeof ticketActions)[number];
export function ticketTransition(row: Pick<ServiceTicket, 'status' | 'resolvedBy'>, action: string, actorId: number) {
  if (!ticketActions.includes(action as TicketAction)) throw new BadRequestException('未知工单操作');
  const allowed: Record<TicketAction, string[]> = {
    assign: ['open', 'assigned', 'in_progress'],
    start: ['assigned'],
    note: ['assigned', 'in_progress'],
    resolve: ['in_progress'],
    close: ['resolved'],
    reopen: ['resolved', 'closed'],
    cancel: ['open', 'assigned', 'in_progress'],
  };
  if (!allowed[action as TicketAction].includes(row.status)) throw new ConflictException('工单当前状态不允许此操作');
  if (action === 'close' && row.resolvedBy === actorId) throw new ForbiddenException('解决人不能自行复核关闭工单');
  return (
    (
      {
        assign: 'assigned',
        start: 'in_progress',
        resolve: 'resolved',
        close: 'closed',
        reopen: 'assigned',
        cancel: 'cancelled',
      } as Record<string, string>
    )[action] ?? row.status
  );
}
export function ticketKeys(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((k) => !allowed.includes(k))) throw new BadRequestException('包含不支持的参数');
}
