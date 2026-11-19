import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { Actor } from '../../common/types/actor';
import { SalesIntakeService } from './sales-intake.service';
import { AnalyticsService } from './analytics.service';
import {BusinessReportService} from './business-report.service';
import { hasPermission } from './access';
import { analyticsCapabilities } from './analytics.contract';
export { analyticsCapabilities } from './analytics.contract';
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService,
    private readonly intake: SalesIntakeService,
    private readonly business: BusinessReportService,
  ) {}
  @Get('funnel') funnel(@CurrentUser() a: Actor, @Query() q: Record<string, string>) {
    return this.intake.list(a, q);
  }
  @Get('options') options(@CurrentUser() a: Actor) {
    return this.service.options(a);
  }
  @Get('schema') schema(@CurrentUser() a: Actor) {
    return analyticsCapabilities.filter(
      (c) =>
        hasPermission(a, c.permission) &&
        (!('additionalPermissions' in c) || c.additionalPermissions?.every((p) => hasPermission(a, p))),
    );
  }
  @Get('forecast') forecast(@CurrentUser() a: Actor, @Query() q: Record<string, string>) {
    return this.service.forecast(a, q);
  }
  @Get('business') businessReport(@CurrentUser() a:Actor,@Query() q:Record<string,string>){return this.business.read(a,q);}
  @Get('collections') collections(@CurrentUser() a: Actor, @Query() q: Record<string, string>) {
    return this.service.collections(a, q);
  }
}
