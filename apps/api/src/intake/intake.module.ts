import { Module } from '@nestjs/common';
import { ConversationTimelineModule } from '../conversations/conversation-timeline.module';
import { RoutingModule } from '../routing/routing.module';
import { IntakeFormService } from './intake-form.service';
import { IntakeService } from './intake.service';
import { TopicCatalogService } from './topic-catalog.service';

/** Topic classification, pre-chat forms, and the intake steps between a first message and routing. */
@Module({
  imports: [RoutingModule, ConversationTimelineModule],
  providers: [TopicCatalogService, IntakeFormService, IntakeService],
  exports: [TopicCatalogService, IntakeFormService, IntakeService],
})
export class IntakeModule {}
