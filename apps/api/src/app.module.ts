import { PrototypeGuard } from './common/guards/prototype.guard';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { CapabilityModule } from './modules/capability/capability.module';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { SystemModule } from './modules/system/system.module';
import { CustomerModule } from './modules/customer/customer.module';
import { PoolModule } from './modules/pool/pool.module';
import { LeadModule } from './modules/lead/lead.module';
import { FollowUpModule } from './modules/follow-up/follow-up.module';
import { OpportunityModule } from './modules/opportunity/opportunity.module';
import { ContractModule } from './modules/contract/contract.module';
import { OrderModule } from './modules/order/order.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ProjectModule } from './modules/project/project.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { NotificationModule } from './modules/notification/notification.module';
import { IntegrationModule } from './modules/integration/integration.module';
import { AiModule } from './modules/ai/ai.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthController } from './health.controller';
import { ReadinessService } from './readiness.service';
import { PoolCronService } from './cron/pool-cron.service';
import { FinanceCronService } from './cron/finance-cron.service';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'], load: [configuration] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    SystemModule,
    CustomerModule,
    PoolModule,
    LeadModule,
    FollowUpModule,
    OpportunityModule,
    ContractModule,
    OrderModule,
    FinanceModule,
    ProjectModule,
    ApprovalModule,
    NotificationModule,
    IntegrationModule,
    AiModule,
    DashboardModule,
    CapabilityModule,
    WorkspaceModule,
  ],
  controllers: [HealthController],
  providers: [ReadinessService, PoolCronService, FinanceCronService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: PrototypeGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
