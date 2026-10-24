import { Module } from '@nestjs/common';
import { ConversationTimelineModule } from '../conversations/conversation-timeline.module';
import { RoutingModule } from '../routing/routing.module';
import { IntakeService } from './intake.service';
import { TopicCatalogService } from './topic-catalog.service';

/** Topic classification and the intake steps between a visitor's first message and routing. */
@Module({
  imports: [RoutingModule, ConversationTimelineModule],
  providers: [TopicCatalogService, IntakeService],
  exports: [TopicCatalogService, IntakeService],
})
export class IntakeModule {}
