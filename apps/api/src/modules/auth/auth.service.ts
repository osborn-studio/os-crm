import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import type { Actor } from '../../common/types/actor';
import { checkVersion, runCommand, object } from '../workspace/command-runner';

type AuthUser = Prisma.UserGetPayload<{
  include: { tenant: true; department: true; roles: { include: { role: true } } };
}>;
const include = { tenant: true, department: true, roles: { include: { role: true } } } as const;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);
const validPassword = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 12 &&
  Buffer.byteLength(value) <= 72 &&
  /[A-Z]/.test(value) &&
  /[a-z]/.test(value) &&
  /[0-9]/.test(value);

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let i = 0; i < 3; i++) {
      try {
        return await this.prisma.system.$transaction(work, { isolationLevel: 'Serializable', timeout: 15000 });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(e.code) && i < 2) continue;
        throw e;
      }
    }
    throw new Error('Transaction retries exhausted');
  }
  async login(dto: LoginDto) {
    const tenantCode = dto.tenantCode ?? 'TINGMENG';
    const key = digest(tenantCode.toLowerCase() + ':' + dto.username.toLowerCase());
    const attempt = await this.prisma.system.authAttempt.findUnique({ where: { key } });
    const now = new Date(),
      windowMs = 15 * 60 * 1000;
    if (attempt && now.getTime() - attempt.windowStartedAt.getTime() < windowMs && attempt.failures >= 8)
      throw new HttpException('登录失败次数过多，请15分钟后重试', 429);
    const user = await this.prisma.system.user.findFirst({
      where: { username: dto.username, deletedAt: null, tenant: { code: tenantCode } },
      include,
    });
    const passwordValid = await bcrypt.compare(dto.password, user?.passwordHash || dummyHash);
    if (!user || !passwordValid) {
      await this.transaction(async (tx) => {
        const previous = await tx.authAttempt.findUnique({ where: { key } });
        if (!previous) await tx.authAttempt.create({ data: { key, failures: 1, windowStartedAt: now } });
        else
          await tx.authAttempt.update({
            where: { key },
            data:
              now.getTime() - previous.windowStartedAt.getTime() >= windowMs
                ? { failures: 1, windowStartedAt: now }
                : { failures: { increment: 1 } },
          });
      });
      throw new UnauthorizedException({ code: 1001, message: '用户名或密码错误' });
    }
    if (user.status !== 'active' || !['active', 'trial'].includes(user.tenant.status))
      throw new ForbiddenException({ code: 1003, message: '账号或企业已停用' });
    const sid = randomUUID();
    return this.transaction(async (tx) => {
      // Recheck after password verification: concurrent reset/disable must not create a valid session.
      const current = await tx.user.findFirst({
        where: {
          id: user.id,
          tenantId: user.tenantId,
          status: 'active',
          deletedAt: null,
          passwordHash: user.passwordHash,
          tenant: { status: { in: ['active', 'trial'] } },
        },
        include,
      });
      if (!current) throw new UnauthorizedException('账号已变更，请重新登录');
      const tokens = this.generateTokens(current, sid);
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      await tx.authAttempt.deleteMany({ where: { key } });
      await tx.authSession.create({
        data: {
          id: sid,
          tenantId: user.tenantId,
          userId: user.id,
          refreshHash: digest(tokens.refreshToken),
          expiresAt: new Date(this.jwtService.decode<{ exp: number }>(tokens.refreshToken).exp * 1000),
        },
      });
      const excess = await tx.authSession.findMany({
        where: { tenantId: user.tenantId, userId: user.id, revokedAt: null, expiresAt: { gt: now }, id: { not: sid } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 19,
        select: { id: true },
      });
      if (excess.length)
        await tx.authSession.updateMany({
          where: { id: { in: excess.map((s) => s.id) }, tenantId: user.tenantId },
          data: { revokedAt: now },
        });
      await tx.auditLog.create({
        data: { tenantId: user.tenantId, userId: user.id, action: 'auth.login', objectType: 'session', objectNo: sid },
      });
      return tokens;
    });
  }
  async dingtalkLogin(_authCode: string) {
    throw new UnauthorizedException({ code: 1008, message: '钉钉免登尚未完成企业联调' });
  }
  async refreshToken(refreshToken: string) {
    let payload: { sub: number; tid: number; sid: string; type: string };
    try {
      if (typeof refreshToken !== 'string' || refreshToken.length > 8192) throw new Error('Invalid token');
      payload = this.jwtService.verify(refreshToken, { algorithms: ['HS256'] });
      if (
        payload.type !== 'refresh' ||
        !Number.isSafeInteger(payload.sub) ||
        !Number.isSafeInteger(payload.tid) ||
        typeof payload.sid !== 'string'
      )
        throw new Error('Invalid claims');
    } catch {
      throw new UnauthorizedException({ code: 1007, message: '刷新令牌无效' });
    }
    const tokens = await this.transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: {
          id: payload.sid,
          tenantId: payload.tid,
          userId: payload.sub,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!session) return null;
      if (session.refreshHash !== digest(refreshToken)) {
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({
          data: {
            tenantId: payload.tid,
            userId: payload.sub,
            action: 'auth.refresh.replay',
            objectType: 'session',
            objectNo: session.id,
          },
        });
        return null; // Commit revocation before throwing outside the transaction.
      }
      const user = await tx.user.findFirst({
        where: {
          id: payload.sub,
          tenantId: payload.tid,
          deletedAt: null,
          status: 'active',
          tenant: { status: { in: ['active', 'trial'] } },
        },
        include,
      });
      if (!user) return null;
      const next = this.generateTokens(user, session.id);
      await tx.authSession.update({ where: { id: session.id }, data: { refreshHash: digest(next.refreshToken) } });
      await tx.auditLog.create({
        data: {
          tenantId: payload.tid,
          userId: payload.sub,
          action: 'auth.refresh',
          objectType: 'session',
          objectNo: session.id,
        },
      });
      return next;
    });
    if (!tokens) throw new UnauthorizedException({ code: 1007, message: '刷新令牌已撤销、使用或过期' });
    return tokens;
  }
  async getProfile(userId: number, tenantId: number) {
    const user = await this.prisma.system.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null, status: 'active' },
      include,
    });
    if (!user) throw new UnauthorizedException('用户不存在');
    const roles = user.roles.map((r) => r.role);
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      avatar: user.avatarUrl,
      dept: user.department ? { id: user.department.id, name: user.department.name } : null,
      roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
      permissions: [
        ...new Set(
          roles.flatMap((r) =>
            Array.isArray(r.permissions) ? r.permissions.filter((p): p is string => typeof p === 'string') : [],
          ),
        ),
      ],
      dataScope: ['all', 'dept', 'team', 'custom', 'self'].find((s) => roles.some((r) => r.dataScope === s)) ?? 'self',
      updatedAt: user.updatedAt,
    };
  }
  async logout(actor: Actor) {
    await this.transaction(async (tx) => {
      await tx.authSession.updateMany({
        where: { id: actor.sessionId ?? '', tenantId: actor.tenantId, userId: actor.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'auth.logout',
          objectType: 'session',
          objectNo: actor.sessionId,
        },
      });
    });
    return { message: '当前会话已撤销' };
  }
  async sessions(actor: Actor) {
    const sessions = await this.prisma.system.authSession.findMany({
      where: { tenantId: actor.tenantId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return sessions.map((s) => ({ ...s, current: s.id === actor.sessionId }));
  }
  async revokeSessions(actor: Actor) {
    await this.transaction(async (tx) => {
      await tx.authSession.updateMany({
        where: { tenantId: actor.tenantId, userId: actor.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: 'auth.sessions.revoke_all',
          objectType: 'user',
          objectId: actor.userId,
        },
      });
    });
    return { message: '全部会话已撤销，请重新登录' };
  }
  async changePassword(actor: Actor, body: Record<string, unknown>) {
    object(body);
    if (
      Object.keys(body).some((k) => !['requestKey', 'expectedUpdatedAt', 'currentPassword', 'newPassword'].includes(k))
    )
      throw new BadRequestException('不允许的密码参数');
    if (!validPassword(body.newPassword))
      throw new BadRequestException('新密码至少12位，含大小写字母和数字，最多72字节');
    if (
      typeof body.currentPassword !== 'string' ||
      !body.currentPassword ||
      Buffer.byteLength(body.currentPassword) > 128
    )
      throw new BadRequestException('原密码参数无效');
    const old = body.currentPassword,
      passwordHash = await bcrypt.hash(body.newPassword, 12);
    return runCommand(this.prisma, actor, 'identity.password.change', body, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: actor.userId, tenantId: actor.tenantId, status: 'active', deletedAt: null },
      });
      if (!user || !(await bcrypt.compare(old, user.passwordHash))) throw new ForbiddenException('原密码错误');
      checkVersion(user, body.expectedUpdatedAt);
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.authSession.updateMany({
        where: { userId: user.id, tenantId: actor.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { message: '密码已修改，全部会话已撤销，请重新登录' };
    });
  }
  private generateTokens(user: AuthUser, sid: string) {
    const roles = user.roles.map((r) => r.role.code);
    const payload = { sub: user.id, tid: user.tenantId, username: user.username, name: user.name, roles, sid };
    const accessToken = this.jwtService.sign(
      { ...payload, jti: randomUUID() },
      { expiresIn: this.config.get('app.jwt.accessExpiresIn', '2h') },
    );
    const refreshToken = this.jwtService.sign(
      { ...payload, jti: randomUUID(), type: 'refresh' },
      { expiresIn: this.config.get('app.jwt.refreshExpiresIn', '7d') },
    );
    const expiresIn = this.jwtService.decode<{ exp: number; iat: number }>(accessToken);
    return {
      accessToken,
      refreshToken,
      expiresIn: expiresIn.exp - expiresIn.iat,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar: user.avatarUrl,
        dept: user.department ? { id: user.department.id, name: user.department.name } : null,
        roles,
      },
    };
  }
}
