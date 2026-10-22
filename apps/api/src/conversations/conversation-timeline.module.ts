import { Module } from '@nestjs/common';
import { ConversationTimelineService } from './conversation-timeline.service';

@Module({ providers: [ConversationTimelineService], exports: [ConversationTimelineService] })
export class ConversationTimelineModule {}
