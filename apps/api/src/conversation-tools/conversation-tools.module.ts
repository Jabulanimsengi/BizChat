import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CannedResponseService } from './canned-response.service';
import { ConversationToolsController } from './conversation-tools.controller';
import { TagService } from './tag.service';

@Module({
  imports: [AuthModule],
  controllers: [ConversationToolsController],
  providers: [TagService, CannedResponseService],
})
export class ConversationToolsModule {}
