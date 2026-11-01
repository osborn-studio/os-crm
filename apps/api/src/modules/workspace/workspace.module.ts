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
@Module({
  imports: [ApprovalModule],
  controllers: [WorkspaceController, CommercialController, FinanceController, ServiceTicketController, AttachmentController],
  providers: [WorkspaceService, CommercialService, FinanceService, ServiceTicketService, AttachmentService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
