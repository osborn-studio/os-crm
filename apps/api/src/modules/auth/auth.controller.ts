import { Public } from '../../common/decorators/public.decorator';
import { Controller, Post, Get, Body, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { identityCapabilities } from './identity-contract';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('capabilities')
  capabilities(@CurrentUser() actor: Actor) {
    return identityCapabilities.filter((c) => c.permission === 'authenticated' || actor.roles.includes('super_admin'));
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '账号密码登录' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('dingtalk/login')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '钉钉免登' })
  async dingtalkLogin(@Body('authCode') authCode: string) {
    return this.authService.dingtalkLogin(authCode);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: '刷新Token' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息+权限' })
  async me(@CurrentUser() user: Actor) {
    return this.authService.getProfile(user.userId, user.tenantId);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: '登出' })
  async logout(@CurrentUser() user: Actor) {
    return this.authService.logout(user);
  }

  @Get('sessions')
  sessions(@CurrentUser() actor: Actor) {
    return this.authService.sessions(actor);
  }

  @Post('sessions/revoke-all')
  @HttpCode(200)
  revokeSessions(@CurrentUser() actor: Actor) {
    return this.authService.revokeSessions(actor);
  }

  @Post('password')
  @HttpCode(200)
  changePassword(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.authService.changePassword(actor, body);
  }
}
