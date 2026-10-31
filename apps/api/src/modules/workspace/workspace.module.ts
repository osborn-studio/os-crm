import { Module } from '@nestjs/common';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { CommercialController } from './commercial.controller';
import { CommercialService } from './commercial.service';
@Module({
  imports: [ApprovalModule],
  controllers: [WorkspaceController, CommercialController],
  providers: [WorkspaceService, CommercialService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
