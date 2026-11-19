import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { TradeService } from './trade.service';
@Controller('trade')
export class TradeController {
  constructor(private readonly service: TradeService) {}
  @Get('schema') schema() {
    return this.service.schema();
  }
  @Get(':kind/:id') detail(
    @CurrentUser() a: Actor,
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.detail(a, kind, id);
  }
  @Post('project-register') projects(@CurrentUser() a: Actor, @Body() body: Record<string, unknown>) {
    return this.service.registerProjects(a, body);
  }
  @Post('classify') classify(@CurrentUser() a: Actor, @Body() body: Record<string, unknown>) {
    return this.service.classify(a, body);
  }
}
