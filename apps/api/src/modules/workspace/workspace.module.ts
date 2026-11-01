import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { CommercialController } from './commercial.controller';
import { CommercialService } from './commercial.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
@Module({
  imports: [ApprovalModule],
  controllers: [WorkspaceController, CommercialController, FinanceController],
  providers: [WorkspaceService, CommercialService, FinanceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
