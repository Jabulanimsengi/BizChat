import { Module } from '@nestjs/common';
import { ConversationRoutingService } from './conversation-routing.service';
import { ConversationTimelineModule } from '../conversations/conversation-timeline.module';

@Module({
  imports: [ConversationTimelineModule],
  providers: [ConversationRoutingService],
  exports: [ConversationRoutingService],
})
export class RoutingModule {}
