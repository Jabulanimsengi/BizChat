import { Module } from '@nestjs/common';
import { ConversationOfferService } from './conversation-offer.service';
import { ConversationRoutingService } from './conversation-routing.service';
import { ConversationTimelineModule } from '../conversations/conversation-timeline.module';

@Module({
  imports: [ConversationTimelineModule],
  providers: [ConversationRoutingService, ConversationOfferService],
  exports: [ConversationRoutingService, ConversationOfferService],
})
export class RoutingModule {}
