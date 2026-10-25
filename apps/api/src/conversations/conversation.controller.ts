import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ConversationEventResponse,
  ConversationIntakeResponse,
  ConversationPage,
  ConversationResponse,
  MessagePage,
  MessageResponse,
} from '@bizchat/types';
import {
  agentMessageSendSchema,
  conversationListQuerySchema,
  conversationOperationSchema,
  conversationStatusUpdateSchema,
  conversationTransferSchema,
  internalNoteSchema,
  messageHistoryQuerySchema,
  setConversationTagsSchema,
  type AgentMessageSendInput,
  type ConversationListQuery,
  type ConversationOperationInput,
  type ConversationStatusUpdateInput,
  type ConversationTransferInput,
  type InternalNoteInput,
  type MessageHistoryQuery,
  type SetConversationTagsInput,
} from '@bizchat/validation';
import { AuthorizationGuard } from '../auth/authorization.guard';
import { CurrentAuth, RequirePermissions } from '../auth/auth.decorators';
import { OriginGuard } from '../auth/origin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { AuthContext } from '../common/http.types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConversationService } from './conversation.service';
import { ConversationOperationsService } from './conversation-operations.service';

@Controller('conversations')
@UseGuards(SessionAuthGuard, AuthorizationGuard)
@RequirePermissions('conversation:view_assigned')
export class ConversationController {
  public constructor(
    private readonly conversations: ConversationService,
    private readonly operations: ConversationOperationsService,
  ) {}

  @Get()
  public list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(conversationListQuerySchema)) query: ConversationListQuery,
  ): Promise<ConversationPage> {
    return this.conversations.listDashboard(auth, query);
  }

  @Get(':id')
  public get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationResponse> {
    return this.conversations.getDashboardConversation(auth, id);
  }

  @Get(':id/intake')
  public intake(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationIntakeResponse | null> {
    return this.conversations.getDashboardIntake(auth, id);
  }

  @Get(':id/messages')
  public history(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(messageHistoryQuerySchema)) query: MessageHistoryQuery,
  ): Promise<MessagePage> {
    return this.conversations.getDashboardHistory(auth, id, query);
  }

  @Post(':id/messages')
  @UseGuards(OriginGuard)
  public send(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(agentMessageSendSchema)) input: AgentMessageSendInput,
  ): Promise<MessageResponse> {
    return this.conversations.sendAgent(auth, id, input);
  }

  @Patch(':id/status')
  @UseGuards(OriginGuard)
  @RequirePermissions('conversation:resolve')
  public updateStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(conversationStatusUpdateSchema))
    input: ConversationStatusUpdateInput,
  ): Promise<ConversationResponse> {
    return this.conversations.updateStatus(auth, id, input);
  }

  @Post(':id/transfer')
  @UseGuards(OriginGuard)
  @RequirePermissions('conversation:transfer')
  public transfer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(conversationTransferSchema)) input: ConversationTransferInput,
  ): Promise<ConversationResponse> {
    return this.operations.transfer(auth, id, input);
  }

  @Post(':id/resolve')
  @UseGuards(OriginGuard)
  @RequirePermissions('conversation:resolve')
  public resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(conversationOperationSchema)) input: ConversationOperationInput,
  ): Promise<ConversationResponse> {
    return this.operations.resolve(auth, id, input);
  }

  @Post(':id/reopen')
  @UseGuards(OriginGuard)
  @RequirePermissions('conversation:resolve')
  public reopen(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(conversationOperationSchema)) input: ConversationOperationInput,
  ): Promise<ConversationResponse> {
    return this.operations.reopen(auth, id, input);
  }

  @Post(':id/notes')
  @UseGuards(OriginGuard)
  @RequirePermissions('conversation:note')
  public note(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(internalNoteSchema)) input: InternalNoteInput,
  ): Promise<MessageResponse> {
    return this.operations.addInternalNote(auth, id, input);
  }

  @Get(':id/events')
  public events(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationEventResponse[]> {
    return this.operations.eventsForConversation(auth, id);
  }

  @Post(':id/tags')
  @UseGuards(OriginGuard)
  @RequirePermissions('conversation:tag')
  public setTags(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setConversationTagsSchema)) input: SetConversationTagsInput,
  ): Promise<ConversationResponse> {
    return this.operations.setTags(auth, id, input);
  }
}
