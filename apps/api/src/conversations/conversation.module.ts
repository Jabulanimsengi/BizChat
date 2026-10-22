import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationStateService } from './conversation-state';
import { MessageService } from './message.service';
import { RoutingModule } from '../routing/routing.module';
import { ConversationOperationsService } from './conversation-operations.service';
import { ConversationTimelineModule } from './conversation-timeline.module';

@Module({
  imports: [AuthModule, RoutingModule, ConversationTimelineModule],
  controllers: [ConversationController],
  providers: [
    ConversationService,
    ConversationOperationsService,
    ConversationStateService,
    MessageService,
  ],
  exports: [ConversationService, ConversationOperationsService, MessageService],
})
export class ConversationModule {}
