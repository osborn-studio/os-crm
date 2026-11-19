import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { AnalyticsController } from './analytics.controller';
import { AllocationController } from './allocation.controller';
import { AnalyticsService } from './analytics.service';
import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { CommercialController } from './commercial.controller';
import { CommercialService } from './commercial.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { ServiceTicketController } from './service-ticket.controller';
import { ServiceTicketService } from './service-ticket.service';
import { AttachmentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';
import { SourceArchiveController } from './source-archive.controller';
import { SourceArchiveService } from './source-archive.service';
import { BusinessRulesController } from './business-rules.controller';
import { SalesIntakeController } from './sales-intake.controller';
import { SalesIntakeService } from './sales-intake.service';
import { TradeController } from './trade.controller';
import { TradeService } from './trade.service';
import { BusinessReportService } from './business-report.service';
@Module({
  imports: [ApprovalModule],
  controllers: [
    AllocationController,
    AnalyticsController,
    WorkspaceController,
    CommercialController,
    FinanceController,
    ServiceTicketController,
    AttachmentController,
    SourceArchiveController,
    BusinessRulesController,
    SalesIntakeController,
    TradeController,
    KnowledgeController,
  ],
  providers: [
    AnalyticsService,
    WorkspaceService,
    CommercialService,
    FinanceService,
    ServiceTicketService,
    AttachmentService,
    SourceArchiveService,
    SalesIntakeService,
    TradeService,
    KnowledgeService,
    BusinessReportService,
  ],
  exports: [WorkspaceService, AnalyticsService, BusinessReportService],
})
export class WorkspaceModule {}
