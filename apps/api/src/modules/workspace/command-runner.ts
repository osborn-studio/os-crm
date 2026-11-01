import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { Actor } from '../../common/types/actor';
export type Tx = Prisma.TransactionClient;
export type Row = Record<string, unknown> & { id: number; updatedAt?: Date; status?: string };
export function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('需要对象参数');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new BadRequestException(`${label}必须为1—${max}字`);
  return value.trim();
}
export function id(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new BadRequestException('对象编号无效');
  return Number(value);
}
export function checkVersion(row: { updatedAt: Date }, expected: unknown) {
  if (typeof expected !== 'string' || row.updatedAt.toISOString() !== expected)
    throw new ConflictException('数据已更新，请刷新后重试');
}
function canonical(value: unknown, depth = 0): unknown {
  if (depth > 20) throw new BadRequestException('参数层级过深');
  if (Array.isArray(value)) return value.map((v) => canonical(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v, depth + 1)]),
    );
  return value;
}
export async function runCommand(
  prisma: PrismaService,
  actor: Actor,
  command: string,
  body: Record<string, unknown>,
  work: (tx: Tx) => Promise<unknown>,
) {
  const key = text(body.requestKey, '请求标识', 80);
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(canonical({ command, body })))
    .digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.system.$transaction(
        async (tx) => {
          // Close the race between the HTTP guard and the write transaction. Role/department
          // changes revoke sessions atomically; an already-loaded actor must not bypass that.
          const live = actor.sessionId
            ? await tx.authSession.findFirst({
                where: {
                  id: actor.sessionId,
                  tenantId: actor.tenantId,
                  userId: actor.userId,
                  revokedAt: null,
                  expiresAt: { gt: new Date() },
                },
              })
            : null;
          const principal = live
            ? await tx.user.findFirst({
                where: {
                  id: actor.userId,
                  tenantId: actor.tenantId,
                  status: 'active',
                  deletedAt: null,
                  tenant: { status: { in: ['active', 'trial'] } },
                },
                include: { roles: { include: { role: true } } },
              })
            : null;
          if (!principal) throw new ForbiddenException('当前执行身份已撤销或变更，请重新登录');
          const roleDefinitions = principal.roles.map((r) => r.role);
          const permissions = [
            ...new Set(
              roleDefinitions.flatMap((r) =>
                Array.isArray(r.permissions) ? r.permissions.filter((p): p is string => typeof p === 'string') : [],
              ),
            ),
          ];
          const scope =
            ['all', 'dept', 'team', 'custom', 'self'].find((s) => roleDefinitions.some((r) => r.dataScope === s)) ??
            'self';
          const same = (a: string[], b: string[]) =>
            JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
          if (
            principal.deptId !== actor.deptId ||
            scope !== actor.dataScope ||
            !same(
              roleDefinitions.map((r) => r.code),
              actor.roles,
            ) ||
            !same(permissions, actor.permissions)
          )
            throw new ForbiddenException('当前执行权限已变更，请重新登录');
          const prior = await tx.commandExecution.findUnique({
            where: {
              tenantId_actorId_requestKey: { tenantId: actor.tenantId, actorId: actor.userId, requestKey: key },
            },
          });
          if (prior) {
            if (prior.command !== command || prior.payloadHash !== payloadHash)
              throw new ConflictException('请求标识已用于其他操作');
            return prior.result;
          }
          const result = json(await work(tx));
          await tx.commandExecution.create({
            data: { tenantId: actor.tenantId, actorId: actor.userId, requestKey: key, command, payloadHash, result },
          });
          await tx.auditLog.create({
            data: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              action: command,
              objectType: command.split('.')[0],
              afterData: result,
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code) &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  throw new ConflictException('操作冲突，请重试');
}
