import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { Actor } from '../../common/types/actor';
import { AgentService } from './agent.service';

@Controller('agent-control')
export class AgentControlController {
  constructor(private readonly service: AgentService) {}
  @Get('schema') schema(@CurrentUser() a: Actor) {
    return this.service.schema(a);
  }
  @Get('grants') grants(@CurrentUser() a: Actor, @Query('after') after?: string) {
    return this.service.list(a, after);
  }
  @Post('grants') issue(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.issue(a, b);
  }
  @Post('grants/:id/revoke') revoke(
    @CurrentUser() a: Actor,
    @Param('id') grantId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.revoke(a, grantId, b);
  }
  @Get('proposals') proposals(@CurrentUser() a: Actor, @Query('after') after?: string) {
    return this.service.proposals(a, after);
  }
  @Get('executions') executions(@CurrentUser() a: Actor, @Query('after') after?: string) {
    return this.service.executions(a, after);
  }
  @Post('proposals/:id/approve') approve(
    @CurrentUser() a: Actor,
    @Param('id') proposalId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.decide(a, proposalId, 'approved', b);
  }
  @Post('proposals/:id/reject') reject(
    @CurrentUser() a: Actor,
    @Param('id') proposalId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.decide(a, proposalId, 'rejected', b);
  }
  @Post('proposals/:id/cancel-action') compensate(
    @CurrentUser() a: Actor,
    @Param('id') proposalId: string,
    @Body() b: Record<string, unknown>,
  ) {
    return this.service.compensate(a, proposalId, b);
  }
}
@Controller('agent-runtime')
@Public()
export class AgentRuntimeController {
  constructor(private readonly service: AgentService) {}
  @Get('capabilities') catalog(@Headers('authorization') token?: string) {
    return this.service.runtimeCatalog(token);
  }
  @Post('invoke') invoke(@Headers('authorization') token: string | undefined, @Body() body: Record<string, unknown>) {
    return this.service.invoke(token, body);
  }
  @Get('receipts/:id') receipt(@Headers('authorization') token: string | undefined, @Param('id') executionId: string) {
    return this.service.receipt(token, executionId);
  }
}
