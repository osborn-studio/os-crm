import { Controller, Get, Post, Put, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { DepartmentService } from './department.service';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { Actor } from '../../../common/types/actor';
@ApiTags('系统管理-部门')
@ApiBearerAuth()
@Controller('system/departments')
export class DepartmentController {
  constructor(private readonly service: DepartmentService) {}
  @Get('tree')
  tree(@CurrentUser() actor: Actor) {
    return this.service.getTree(actor);
  }
  @Post()
  create(@CurrentUser() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.service.save(actor, null, body);
  }
  @Put(':id')
  update(@CurrentUser() actor: Actor, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.save(actor, id, body);
  }
}
