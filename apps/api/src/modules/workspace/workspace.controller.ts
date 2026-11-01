import { Controller, Get, Post, Put, Param, Query, Body, ParseIntPipe } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { WorkspaceService } from './workspace.service';
@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}
  @Get('schema') schema(@CurrentUser() a: Actor) {
    return this.service.schema(a);
  }
  @Get('overview') overview(@CurrentUser() a: Actor) {
    return this.service.overview(a);
  }
  @Get(':kind') list(@CurrentUser() a: Actor, @Param('kind') kind: string, @Query() q: Record<string, string>) {
    return this.service.list(a, kind, q);
  }
  @Get(':kind/:id') detail(
    @CurrentUser() a: Actor,
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) recordId: number,
  ) {
    return this.service.detail(a, kind, recordId);
  }
  @Get(':kind/:id/approval-form') approvalForm(
    @CurrentUser() a: Actor,
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) recordId: number,
  ) {
    return this.service.approvalForm(a, kind, recordId);
  }
  @Get(':kind/:id/delivery-people') deliveryPeople(
    @CurrentUser() a: Actor,
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) recordId: number,
  ) {
    return this.service.deliveryRecipients(a, kind, recordId);
  }
  @Post(':kind') create(@CurrentUser() a: Actor, @Param('kind') kind: string, @Body() b: Record<string, unknown>) {
    return this.service.save(a, kind, b);
  }
  @Put(':kind/:id') update(
    @CurrentUser() a: Actor,
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) recordId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.save(a, kind, b, recordId);
  }
  @Post(':kind/:id/:action') command(
    @CurrentUser() a: Actor,
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) recordId: number,
    @Param('action') action: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.command(a, kind, recordId, action, b);
  }
}
