import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationModule } from '../conversations/conversation.module';
import { AgentProfileController } from './agent-profile.controller';
import { AgentProfileService } from './agent-profile.service';
import { AgentGateway } from './agent.gateway';
import { RoutingModule } from '../routing/routing.module';
import { ReliabilityModule } from '../reliability/reliability.module';
import { BusinessHoursModule } from '../business-hours/business-hours.module';

@Module({
  imports: [AuthModule, ConversationModule, RoutingModule, ReliabilityModule, BusinessHoursModule],
  controllers: [AgentProfileController],
  providers: [AgentProfileService, AgentGateway],
  exports: [AgentProfileService],
})
export class AgentModule {}
