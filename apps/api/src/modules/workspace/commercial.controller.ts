import { Controller, Get, Post, Param, Query, Body, ParseIntPipe } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { CommercialService } from './commercial.service';
import { commercialCapabilities } from './commercial-contract';
import { hasPermission } from './access';
@Controller('commercial')
export class CommercialController {
  constructor(private readonly service: CommercialService) {}
  @Get('opportunity-stages')
  stages(@CurrentUser() a: Actor) {
    return this.service.stages(a);
  }
  @Get('customers/handover/options')
  options(@CurrentUser() a: Actor, @Query('keyword') keyword?: string) {
    return this.service.options(a, typeof keyword === 'string' ? keyword : '');
  }
  @Get('contracts/:id/changes')
  changes(@CurrentUser() a: Actor, @Param('id', ParseIntPipe) contractId: number) {
    return this.service.changes(a, contractId);
  }
  @Get('schema')
  schema(@CurrentUser() a: Actor) {
    return commercialCapabilities
      .filter((c) => hasPermission(a, c.permission))
      .filter((c) =>
        c.access === 'read'
          ? true
          : c.access === 'admin'
            ? a.roles.includes('super_admin')
            : c.access === 'supervisor'
              ? a.roles.some((r) => ['super_admin', 'sales_manager'].includes(r))
              : a.roles.some((r) => ['super_admin', 'sales_manager', 'sales'].includes(r)),
      );
  }
  @Post('customers/import/preview')
  previewImport(@CurrentUser() a: Actor, @Body() body: Record<string, unknown>) {
    return this.service.previewImport(a, body);
  }
  @Post('customers/import/commit')
  commitImport(@CurrentUser() a: Actor, @Body() body: Record<string, unknown>) {
    return this.service.commitImport(a, body);
  }
  @Post('customers/:id/handover/preview')
  previewHandover(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) customerId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.previewHandover(a, customerId, body);
  }
  @Post('customers/:id/handover')
  handover(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) customerId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.handover(a, customerId, body);
  }
  @Post('contracts/:id/changes/preview')
  previewChange(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) contractId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.previewChange(a, contractId, body);
  }
  @Post('contracts/:id/changes')
  requestChange(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) contractId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.requestChange(a, contractId, body);
  }
}
