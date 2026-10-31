import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { Actor } from '../../../common/types/actor';
import { checkVersion, id, object, runCommand, text } from '../../workspace/command-runner';
@Injectable()
export class DepartmentService {
  constructor(private prisma: PrismaService) {}
  async getTree(actor: Actor) {
    if (!actor.roles.includes('super_admin')) throw new ForbiddenException('仅管理员可管理组织');
    // Flat rows avoid losing orphaned legacy departments; the UI may group them by parentId.
    return this.prisma.system.department.findMany({
      where: { tenantId: actor.tenantId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      take: 2000,
    });
  }
  async save(actor: Actor, target: number | null, body: Record<string, unknown>) {
    if (!actor.roles.includes('super_admin')) throw new ForbiddenException('仅管理员可管理组织');
    object(body);
    if (Object.keys(body).some((k) => !['requestKey', 'expectedUpdatedAt', 'data'].includes(k)))
      throw new BadRequestException('不允许的组织参数');
    const data = object(body.data);
    if (Object.keys(data).some((k) => !['name', 'code', 'parentId', 'leaderId', 'status'].includes(k)))
      throw new BadRequestException('不允许的部门字段');
    return runCommand(
      this.prisma,
      actor,
      target ? 'identity.department.update' : 'identity.department.create',
      body,
      async (tx) => {
        await tx.tenant.update({ where: { id: actor.tenantId }, data: { updatedAt: new Date() } });
        const previous = target
          ? await tx.department.findFirst({ where: { id: target, tenantId: actor.tenantId, deletedAt: null } })
          : null;
        if (target && !previous) throw new NotFoundException('部门不存在');
        if (previous) checkVersion(previous, body.expectedUpdatedAt);
        const parentId =
          data.parentId === undefined
            ? (previous?.parentId ?? null)
            : data.parentId === null
              ? null
              : id(data.parentId);
        let parent = parentId,
          depth = 0;
        while (parent !== null) {
          if (parent === target || ++depth > 20) throw new BadRequestException('部门不能循环引用或超过20层');
          const record = await tx.department.findFirst({
            where: { id: parent, tenantId: actor.tenantId, deletedAt: null, status: 1 },
          });
          if (!record) throw new BadRequestException('上级部门不存在或已停用');
          parent = record.parentId;
        }
        const leaderId =
          data.leaderId === undefined
            ? (previous?.leaderId ?? null)
            : data.leaderId === null
              ? null
              : id(data.leaderId);
        if (
          leaderId !== null &&
          (!target ||
            !(await tx.user.findFirst({
              where: { id: leaderId, tenantId: actor.tenantId, deptId: target, status: 'active', deletedAt: null },
            })))
        )
          throw new BadRequestException('负责人必须是本部门的有效成员');
        const status = data.status === undefined ? (previous?.status ?? 1) : data.status;
        if (status !== 0 && status !== 1) throw new BadRequestException('无效部门状态');
        if (
          target &&
          status === 0 &&
          ((await tx.user.count({
            where: { tenantId: actor.tenantId, deptId: target, status: 'active', deletedAt: null },
          })) ||
            (await tx.department.count({
              where: { tenantId: actor.tenantId, parentId: target, status: 1, deletedAt: null },
            })))
        )
          throw new ConflictException('先迁移有效成员和下级部门，再停用此部门');
        const fields = {
          name: data.name === undefined && previous ? previous.name : text(data.name, '部门名称', 100),
          code:
            data.code === undefined
              ? (previous?.code ?? null)
              : data.code === null || data.code === ''
                ? null
                : text(data.code, '部门编码', 30),
          parentId,
          leaderId,
          status,
        };
        if (
          fields.code &&
          (await tx.department.findFirst({
            where: {
              tenantId: actor.tenantId,
              code: fields.code,
              deletedAt: null,
              ...(target ? { id: { not: target } } : {}),
            },
          }))
        )
          throw new ConflictException('部门编码已存在');
        return previous
          ? tx.department.update({ where: { id: previous.id }, data: fields })
          : tx.department.create({ data: { tenantId: actor.tenantId, ...fields } });
      },
    );
  }
}
