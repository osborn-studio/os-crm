import { Controller, Get, Post, Put, Body, Param, Query, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Actor } from '../../../common/types/actor';
@ApiTags('系统管理-用户')
@ApiBearerAuth()
@Controller('system/users')
export class UserController {
  constructor(private readonly service: UserService) {}
  @Get('capabilities')
  schema(@CurrentUser() actor: Actor) {
    return this.service.schema(actor);
  }
  @Get()
  list(
    @CurrentUser() actor: Actor,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(actor, { page: Number(page), pageSize: Number(pageSize), keyword, status });
  }
  @Get(':id')
  get(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(actor, id);
  }
  @Post()
  create(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.service.create(actor, body);
  }
  @Put(':id')
  update(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.update(actor, id, body);
  }
  @Post(':id/reset-password')
  reset(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.resetPassword(actor, id, body);
  }
}
