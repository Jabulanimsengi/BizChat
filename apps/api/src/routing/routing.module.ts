import { Module } from '@nestjs/common';
import { ConversationOfferService } from './conversation-offer.service';
import { ConversationRoutingService } from './conversation-routing.service';
import { QueueWaitService } from './queue-wait.service';
import { BusinessHoursModule } from '../business-hours/business-hours.module';
import { ConversationTimelineModule } from '../conversations/conversation-timeline.module';

@Module({
  imports: [ConversationTimelineModule, BusinessHoursModule],
  providers: [ConversationRoutingService, ConversationOfferService, QueueWaitService],
  exports: [ConversationRoutingService, ConversationOfferService, QueueWaitService],
})
export class RoutingModule {}
