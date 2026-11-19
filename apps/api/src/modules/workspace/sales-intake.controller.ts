import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { SalesIntakeService } from './sales-intake.service';
@Controller('sales-intake')
export class SalesIntakeController {
  constructor(private readonly service: SalesIntakeService) {}
  @Get('schema') schema() {
    return this.service.schema();
  }
  @Post('archives') archive(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.archive(a, b);
  }
  @Post('activities') activities(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.activities(a, b);
  }
  @Post('contract-plans') contractPlans(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.contractPlans(a, b);
  }
  @Post('action-calendar') actionCalendar(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>){
    return this.service.actionCalendar(a,b);
  }
  @Post('preview') preview(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.preview(a, b);
  }
  @Post('commit') commit(@CurrentUser() a: Actor, @Body() b: Record<string, unknown>) {
    return this.service.commit(a, b);
  }
  @Get() list(@CurrentUser() a: Actor, @Query() q: Record<string, string>) {
    return this.service.list(a, q);
  }
}
