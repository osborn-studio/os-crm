import { Controller, Get, Post, Param, Body, ParseIntPipe, ForbiddenException } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { FinanceService } from './finance.service';
import { financeCapabilities } from './finance-contract';
import { admin, hasPermission } from './access';
@Controller('finance-ledger')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}
  @Get('schema') schema(@CurrentUser() a: Actor) {
    if (!hasPermission(a, 'finance:read')) throw new ForbiddenException('没有财务读取权限');
    return financeCapabilities.filter((c) => c.effect === 'read' || admin(a));
  }
  @Get('plans') plans(@CurrentUser() a: Actor) {
    return this.service.plans(a);
  }
  @Get('receipts') list(@CurrentUser() a: Actor) {
    return this.service.list(a);
  }
  @Get('receipts/:id') detail(@CurrentUser() a: Actor, @Param('id', ParseIntPipe) recordId: number) {
    return this.service.detail(a, recordId);
  }
  @Post('receipts') create(@CurrentUser() a: Actor, @Body() body: Record<string, unknown>) {
    return this.service.create(a, body);
  }
  @Post('receipts/:id/:action') command(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) recordId: number,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.command(a, recordId, action, body);
  }
}
