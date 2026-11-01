import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { ServiceTicketService } from './service-ticket.service';
import { serviceTicketCapabilities } from './service-ticket-contract';
import { hasPermission } from './access';
@Controller('service-tickets')
export class ServiceTicketController {
  constructor(private readonly service: ServiceTicketService) {}
  @Get('schema') schema(@CurrentUser() a: Actor) {
    return serviceTicketCapabilities.filter(
      (c) =>
        hasPermission(a, c.permission) &&
        (c.effect === 'read' || a.roles.some((r) => ['super_admin', 'sales_manager', 'sales'].includes(r))),
    );
  }
  @Get() list(@CurrentUser() a: Actor, @Query('cursor') cursor?: string) {
    return this.service.list(a, cursor);
  }
  @Get(':id') detail(@CurrentUser() a: Actor, @Param('id', ParseIntPipe) id: number, @Query('cursor') cursor?: string) {
    return this.service.detail(a, id, cursor);
  }
  @Get(':id/people') people(@CurrentUser() a: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.service.people(a, id);
  }
  @Post() create(@CurrentUser() a: Actor, @Body() body: Record<string, unknown>) {
    return this.service.create(a, body);
  }
  @Post(':id/:action') command(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) id: number,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.command(a, id, action, body);
  }
}
