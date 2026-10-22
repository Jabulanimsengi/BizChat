import { Module } from '@nestjs/common';
import { ConversationTimelineModule } from '../conversations/conversation-timeline.module';
import { RoutingModule } from '../routing/routing.module';
import { ConversationReliabilityService } from './conversation-reliability.service';

@Module({
  imports: [RoutingModule, ConversationTimelineModule],
  providers: [ConversationReliabilityService],
  exports: [ConversationReliabilityService],
})
export class ReliabilityModule {}
