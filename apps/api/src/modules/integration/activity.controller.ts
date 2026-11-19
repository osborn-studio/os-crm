import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import type { Actor } from '../../common/types/actor';
import { CalendarService } from './calendar.service';
import { ActivitySyncService } from './activity-sync.service';
import { activityCapabilities } from './activity.contract';
import { CalendarInboundService } from './calendar-inbound.service';
@Controller('calendar')
export class CalendarController {
  constructor(private service: CalendarService) {}
  @Get('schema') schema() {
    return activityCapabilities;
  }
  @Get() @Permissions('action:read') list(
    @CurrentUser() a: Actor,
    @Query('from') from: string,
    @Query('until') until: string,
    @Query() query: Record<string,string>,
  ) {
    return this.service.list(a, from, until,query);
  }
  @Post() @Permissions('action:create') create(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.save(a, null, b);
  }
  @Put(':id') @Permissions('action:update') update(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) entryId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.save(a, entryId, b);
  }
}
@Controller('integrations/dingtalk-activities')
export class ActivitySyncController {
  constructor(private service: ActivitySyncService, private inbound: CalendarInboundService) {}
  @Post('pull') pull(@CurrentUser() a: Actor) { return this.inbound.refresh(a); }
  @Get('schema') schema() {
    return activityCapabilities;
  }
  @Get() state(@CurrentUser() a: Actor) {
    return this.service.state(a);
  }
  @Get('history') history(@CurrentUser() a: Actor, @Query('before') before?: string) {
    return this.service.history(a, before);
  }
  @Post('settings') configure(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.configure(a, b);
  }
  @Get('preview') preview(@CurrentUser() a: Actor) {
    return this.service.preview(a);
  }
  @Post('prepare') prepare(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.prepare(a, b);
  }
  @Post('jobs/:id/dispatch') dispatch(
    @CurrentUser() a: Actor,
    @Param('id') jobId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.dispatch(a, jobId, b);
  }
  @Post('jobs/:id/cancel') cancel(
    @CurrentUser() a: Actor,
    @Param('id') jobId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.cancel(a, jobId, b);
  }
  @Post('jobs/:id/stop') stop(@CurrentUser() a: Actor, @Param('id') jobId: string, @Body() b: Record<string, unknown>) {
    return this.service.control(a, jobId, b, false);
  }
  @Post('jobs/:id/resume') resume(
    @CurrentUser() a: Actor,
    @Param('id') jobId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.control(a, jobId, b, true);
  }
  @Post('links/:id/archive') archive(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) linkId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.archive(a, linkId, b);
  }
  @Post('jobs/:id/reconcile') reconcile(
    @CurrentUser() a: Actor,
    @Param('id') jobId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.reconcile(a, jobId, b);
  }
}
