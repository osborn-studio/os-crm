import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { KnowledgeService } from './knowledge.service';
@Controller('business-knowledge')
export class KnowledgeController {
  constructor(private readonly service: KnowledgeService) {}
  @Get('schema') schema() {
    return this.service.schema();
  }
  @Get() list(@CurrentUser() a: Actor, @Query() q: Record<string, unknown>) {
    return this.service.list(a, q);
  }
  @Post('preview') preview(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.preview(a, b);
  }
  @Post('activities') activities(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.activities(a, b);
  }
  @Post('commit') commit(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.commit(a, b);
  }
}
