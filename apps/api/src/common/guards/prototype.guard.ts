import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
/** Retire prototype routes that bypass the shared, tested workspace command boundary. */
@Injectable()
export class PrototypeGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{ url: string; method: string; user?: { roles: string[] } }>();
    const path = req.url.split('?')[0].replace(/^\/api\/v1/, '');
    if (
      /^\/(customers|contacts|leads|pool|opportunities|contracts|orders|projects|follow-ups|action-plans|finance|invoices|receipts|payment-plans|dashboard|ai)(\/|$)/.test(
        path,
      )
    )
      throw new ServiceUnavailableException('原型入口已停用，请使用 /workspace 业务能力接口');
    if (path.startsWith('/system/') && !req.user?.roles.includes('super_admin'))
      throw new ForbiddenException('仅管理员可访问系统管理');
    if (/^\/system\/roles(\/|$)/.test(path) && req.method !== 'GET')
      throw new ServiceUnavailableException('当前仅支持四种预置角色，角色定义写入尚未验收');
    return true;
  }
}
