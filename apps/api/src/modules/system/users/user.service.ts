import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import type { Actor } from '../../../common/types/actor';
import { identityCapabilities } from '../../auth/identity-contract';
import { checkVersion, id, object, runCommand, text, type Tx } from '../../workspace/command-runner';
const include = { department: true, roles: { include: { role: true } } } as const;
type UserRow = Prisma.UserGetPayload<{ include: typeof include }>;
const allowedRoles = ['super_admin', 'sales_manager', 'sales', 'gm'];
function administrator(actor: Actor) {
  if (!actor.roles.includes('super_admin')) throw new ForbiddenException('仅管理员可管理人员');
}
function password(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length < 12 ||
    Buffer.byteLength(value) > 72 ||
    !/[A-Z]/.test(value) ||
    !/[a-z]/.test(value) ||
    !/[0-9]/.test(value)
  )
    throw new BadRequestException('密码至少12位，含大小写字母和数字，最多72字节');
  return value;
}
function envelope(body: Record<string, unknown>, keys: string[]) {
  object(body);
  if (Object.keys(body).some((k) => !['requestKey', 'expectedUpdatedAt', 'data'].includes(k)))
    throw new BadRequestException('不允许的请求字段');
  const data = object(body.data);
  for (const field of ['email', 'position'])
    if (field in data && data[field] !== null && typeof data[field] !== 'string')
      throw new BadRequestException('邮箱和职位需要文本或空值');
  if (Object.keys(data).some((k) => !keys.includes(k))) throw new BadRequestException('不允许的用户字段');
  return data;
}
function view(user: UserRow) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    deptId: user.deptId,
    dept: user.department ? { id: user.department.id, name: user.department.name } : null,
    position: user.position,
    status: user.status,
    roles: user.roles.map((r) => ({ id: r.role.id, code: r.role.code, name: r.role.name })),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}
  async findAll(actor: Actor, query: { page?: number; pageSize?: number; keyword?: string; status?: string }) {
    administrator(actor);
    if (query.status && !['active', 'inactive', 'resigned'].includes(query.status))
      throw new BadRequestException('无效用户状态');
    const page = Math.max(1, Math.min(100000, Math.trunc(query.page || 1))),
      pageSize = Math.max(1, Math.min(100, Math.trunc(query.pageSize || 20)));
    const where: Prisma.UserWhereInput = {
      tenantId: actor.tenantId,
      deletedAt: null,
      ...(query.status ? { status: query.status as 'active' | 'inactive' | 'resigned' } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword.slice(0, 100) } },
              { username: { contains: query.keyword.slice(0, 100) } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.system.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'asc' },
        include,
      }),
      this.prisma.system.user.count({ where }),
    ]);
    return { items: rows.map(view), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }
  async findOne(actor: Actor, target: number) {
    administrator(actor);
    const user = await this.prisma.system.user.findFirst({
      where: { tenantId: actor.tenantId, id: target, deletedAt: null },
      include,
    });
    if (!user) throw new NotFoundException('用户不存在');
    return view(user);
  }
  schema(actor: Actor) {
    administrator(actor);
    return { version: '1.0', capabilities: identityCapabilities };
  }
  private async references(tx: Tx, tenantId: number, data: Record<string, unknown>, creating = false) {
    let deptId: number | null | undefined;
    if ('deptId' in data) {
      deptId = data.deptId === null ? null : id(data.deptId);
      if (
        deptId !== null &&
        !(await tx.department.findFirst({ where: { id: deptId, tenantId, deletedAt: null, status: 1 } }))
      )
        throw new BadRequestException('部门不存在或已停用');
    }
    let roleIds: number[] | undefined;
    if ('roleIds' in data || creating) {
      if (!Array.isArray(data.roleIds) || data.roleIds.length !== 1)
        throw new BadRequestException('请选择一种预置角色，暂不支持角色混用');
      roleIds = data.roleIds.map(id);
      if (new Set(roleIds).size !== roleIds.length) throw new BadRequestException('角色不能重复');
      const roles = await tx.role.findMany({ where: { tenantId, id: { in: roleIds }, code: { in: allowedRoles } } });
      if (roles.length !== roleIds.length) throw new BadRequestException('角色不属于当前企业或暂不支持');
    }
    return { deptId, roleIds };
  }
  async create(actor: Actor, body: Record<string, unknown>) {
    administrator(actor);
    const data = envelope(body, ['username', 'name', 'password', 'deptId', 'roleIds', 'email', 'position']);
    const username = text(data.username, '账号', 40);
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(username))
      throw new BadRequestException('账号需2至40位字母、数字、下划线或短横线');
    const name = text(data.name, '姓名', 50),
      hash = await bcrypt.hash(password(data.password), 12);
    return runCommand(this.prisma, actor, 'identity.user.create', body, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      // Serializes administrator and seat changes with other personnel commands.
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { updatedAt: new Date() } });
      if (
        (await tx.user.count({ where: { tenantId: actor.tenantId, status: 'active', deletedAt: null } })) >=
        tenant.maxUsers
      )
        throw new ConflictException('企业可用账号数量已达上限');
      if (await tx.user.findFirst({ where: { tenantId: actor.tenantId, username } }))
        throw new ConflictException('账号已存在');
      const refs = await this.references(tx, actor.tenantId, data, true);
      const user = await tx.user.create({
        data: {
          tenantId: actor.tenantId,
          username,
          name,
          passwordHash: hash,
          deptId: refs.deptId,
          email: data.email ? text(data.email, '邮箱', 100) : null,
          position: data.position ? text(data.position, '职位', 50) : null,
          createdBy: actor.userId,
        },
      });
      await tx.userRole.createMany({
        data: refs.roleIds!.map((roleId) => ({ tenantId: actor.tenantId, userId: user.id, roleId })),
      });
      return view(await tx.user.findUniqueOrThrow({ where: { id: user.id }, include }));
    });
  }
  async update(actor: Actor, target: number, body: Record<string, unknown>) {
    administrator(actor);
    const data = envelope(body, ['name', 'deptId', 'roleIds', 'email', 'position', 'status']);
    return runCommand(this.prisma, actor, 'identity.user.update', body, async (tx) => {
      await tx.tenant.update({ where: { id: actor.tenantId }, data: { updatedAt: new Date() } });
      const user = await tx.user.findFirst({
        where: { id: target, tenantId: actor.tenantId, deletedAt: null },
        include,
      });
      if (!user) throw new NotFoundException('用户不存在');
      checkVersion(user, body.expectedUpdatedAt);
      const refs = await this.references(tx, actor.tenantId, data);
      if (
        data.status !== undefined &&
        (typeof data.status !== 'string' || !['active', 'inactive', 'resigned'].includes(data.status))
      )
        throw new BadRequestException('无效用户状态');
      const status = data.status === undefined ? user.status : (data.status as 'active' | 'inactive' | 'resigned');
      const roleIds = refs.roleIds ?? user.roles.map((r) => r.role.id);
      const adminRole = await tx.role.findFirstOrThrow({ where: { tenantId: actor.tenantId, code: 'super_admin' } });
      const remainsAdmin = roleIds.includes(adminRole.id) && status === 'active';
      if (target === actor.userId && !remainsAdmin) throw new ConflictException('不能停用自己或移除自己的管理员角色');
      const wasAdmin = user.status === 'active' && user.roles.some((r) => r.role.code === 'super_admin');
      if (
        wasAdmin &&
        !remainsAdmin &&
        (await tx.user.count({
          where: {
            tenantId: actor.tenantId,
            status: 'active',
            deletedAt: null,
            roles: { some: { roleId: adminRole.id } },
          },
        })) <= 1
      )
        throw new ConflictException('必须保留至少一名有效管理员');
      if (user.status !== 'active' && status === 'active') {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
        if (
          (await tx.user.count({ where: { tenantId: actor.tenantId, status: 'active', deletedAt: null } })) >=
          tenant.maxUsers
        )
          throw new ConflictException('企业可用账号数量已达上限');
      }
      const securityChange =
        status !== user.status ||
        (refs.deptId !== undefined && refs.deptId !== user.deptId) ||
        roleIds.slice().sort().join() !==
          user.roles
            .map((r) => r.role.id)
            .sort()
            .join();
      if (
        securityChange &&
        (await tx.approvalNode.count({
          where: { tenantId: actor.tenantId, approverId: target, action: 'pending', approval: { status: 'pending' } },
        }))
      )
        throw new ConflictException('该用户仍有待处理审批，请先完成或撤回审批；紧急撤销访问可先重置密码');
      await tx.user.update({
        where: { id: target },
        data: {
          name: data.name === undefined ? undefined : text(data.name, '姓名', 50),
          deptId: refs.deptId,
          email: data.email === undefined ? undefined : data.email ? text(data.email, '邮箱', 100) : null,
          position: data.position === undefined ? undefined : data.position ? text(data.position, '职位', 50) : null,
          status,
          updatedBy: actor.userId,
        },
      });
      if (refs.roleIds) {
        await tx.userRole.deleteMany({ where: { tenantId: actor.tenantId, userId: target } });
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({ tenantId: actor.tenantId, userId: target, roleId })),
        });
      }
      if (securityChange)
        await tx.authSession.updateMany({
          where: { tenantId: actor.tenantId, userId: target, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      const canLeadApproval = await tx.role.count({
        where: { tenantId: actor.tenantId, id: { in: roleIds }, code: { in: ['super_admin', 'sales_manager', 'gm'] } },
      });
      if (status !== 'active' || (refs.deptId !== undefined && refs.deptId !== user.deptId) || !canLeadApproval)
        await tx.department.updateMany({
          where: { tenantId: actor.tenantId, leaderId: target },
          data: { leaderId: null },
        });
      return view(await tx.user.findUniqueOrThrow({ where: { id: target }, include }));
    });
  }
  async resetPassword(actor: Actor, target: number, body: Record<string, unknown>) {
    administrator(actor);
    const data = envelope(body, ['password']),
      passwordHash = await bcrypt.hash(password(data.password), 12);
    return runCommand(this.prisma, actor, 'identity.user.password.reset', body, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: target, tenantId: actor.tenantId, deletedAt: null } });
      if (!user) throw new NotFoundException('用户不存在');
      checkVersion(user, body.expectedUpdatedAt);
      await tx.user.update({ where: { id: target }, data: { passwordHash, updatedBy: actor.userId } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const key = createHash('sha256')
        .update(tenant.code.toLowerCase() + ':' + user.username.toLowerCase())
        .digest('hex');
      await tx.authAttempt.deleteMany({ where: { key } });
      await tx.authSession.updateMany({
        where: { tenantId: actor.tenantId, userId: target, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { userId: target, message: '密码已重置，目标用户全部会话已撤销' };
    });
  }
}
