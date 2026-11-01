import { approvalCatalog } from './approval.catalog';
import { Controller, Get, Post, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalService } from './approval.service';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
@ApiTags('审批中心与流程设计器')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly service: ApprovalService) {}
  @Get('schema') schema(@CurrentUser() a: Actor) {
    return approvalCatalog(a);
  }
  @Get('flows') flows(@CurrentUser() a: Actor) {
    return this.service.flows(a);
  }
  @Get('people') @Permissions('approval:design') people(@CurrentUser() a: Actor) {
    return this.service.people(a);
  }
  @Post('flows') @Permissions('approval:design') save(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.saveFlow(a, b);
  }
  @Post('flows/:id/publish') @Permissions('approval:design') publish(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) flowId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.publish(a, flowId, b);
  }
  @Post('flows/:id/preview') preview(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) flowId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.preview(a, flowId, b);
  }
  @Get('pending') pending(@CurrentUser() a: Actor) {
    return this.service.pending(a);
  }
  @Get('pending-count') async count(@CurrentUser() a: Actor) {
    return { count: (await this.service.pending(a)).length };
  }
  @Get('my-initiated') initiated(@CurrentUser() a: Actor) {
    return this.service.initiated(a);
  }
  @Get('history') history(@CurrentUser() a: Actor, @Query('after') after?: string) {
    return this.service.history(a, after);
  }
  @Get(':id') detail(@CurrentUser() a: Actor, @Param('id', ParseIntPipe) approvalId: number) {
    return this.service.detail(a, approvalId);
  }
  @Get(':id/events') events(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) approvalId: number,
    @Query('after') after?: string,
  ) {
    return this.service.events(a, approvalId, after);
  }
  @Get(':id/nodes/:nodeId/transfer-people') transferPeople(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) approvalId: number,
    @Param('nodeId', ParseIntPipe) nodeId: number,
    @Query('after') after?: string,
  ) {
    return this.service.transferPeople(a, approvalId, nodeId, after);
  }
  @Post(':id/nodes/:nodeId/transfer') transfer(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) approvalId: number,
    @Param('nodeId', ParseIntPipe) nodeId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.transfer(a, approvalId, nodeId, b);
  }
  @Post() @Permissions('approval:create') create(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.create(a, b);
  }
  @Post(':id/nodes/:nodeId/approve') @Permissions('approval:approve') approve(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) approvalId: number,
    @Param('nodeId', ParseIntPipe) nodeId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.decide(a, approvalId, nodeId, 'approved', b);
  }
  @Post(':id/nodes/:nodeId/reject') @Permissions('approval:reject') reject(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) approvalId: number,
    @Param('nodeId', ParseIntPipe) nodeId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.decide(a, approvalId, nodeId, 'rejected', b);
  }
  @Post(':id/withdraw') @Permissions('approval:withdraw') withdraw(
    @CurrentUser() a: Actor,
    @Param('id', ParseIntPipe) approvalId: number,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.withdraw(a, approvalId, b);
  }
}
