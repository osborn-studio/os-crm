import { WorkspaceModule } from '../workspace/workspace.module';
import { ApprovalModule } from '../approval/approval.module';
import { McpController } from './mcp.controller';
import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { CapabilityController } from './capability.controller';
import { CapabilityService } from './capability.service';
import { AgentService } from './agent.service';
import { AgentControlController, AgentRuntimeController } from './agent.controller';
import { AgentMcpController } from './agent-mcp.controller';

@Module({
  imports: [CustomerModule, WorkspaceModule, ApprovalModule],
  controllers: [
    CapabilityController,
    McpController,
    AgentControlController,
    AgentRuntimeController,
    AgentMcpController,
  ],
  providers: [CapabilityService, AgentService],
})
export class CapabilityModule {}
