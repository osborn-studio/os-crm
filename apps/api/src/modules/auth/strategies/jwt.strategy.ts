import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';

export interface JwtPayload {
  sub: number;
  tid: number;
  type?: string;
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['HS256'],
      secretOrKey: config.getOrThrow<string>('app.jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    if (
      !Number.isSafeInteger(payload.sub) ||
      !Number.isSafeInteger(payload.tid) ||
      payload.sub <= 0 ||
      payload.tid <= 0 ||
      payload.type === 'refresh' ||
      typeof payload.sid !== 'string'
    ) {
      throw new UnauthorizedException({ code: 1005, message: '登录状态无效，请重新登录' });
    }
    // Rehydrate permissions on every request, so role changes and disabled accounts take effect.
    const user = await this.prisma.system.user.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tid,
        deletedAt: null,
        status: 'active',
        tenant: { status: { in: ['active', 'trial'] } },
      },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new UnauthorizedException({ code: 1005, message: '账号或租户不可用' });
    const session = await this.prisma.system.authSession.findFirst({
      where: {
        id: payload.sid,
        tenantId: user.tenantId,
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!session) throw new UnauthorizedException({ code: 1005, message: '会话已撤销或过期，请重新登录' });
    const roles = user.roles.map((entry) => entry.role);
    const scopes = ['all', 'dept', 'team', 'custom', 'self'] as const;
    return {
      userId: user.id,
      tenantId: user.tenantId,
      username: user.username,
      name: user.name,
      sessionId: session.id,
      deptId: user.deptId,
      roles: roles.map((role) => role.code),
      permissions: [
        ...new Set(
          roles.flatMap((role) =>
            Array.isArray(role.permissions)
              ? role.permissions.filter((permission): permission is string => typeof permission === 'string')
              : [],
          ),
        ),
      ],
      dataScope: scopes.find((scope) => roles.some((role) => role.dataScope === scope)) ?? 'self',
    };
  }
}
