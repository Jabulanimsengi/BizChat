import { HttpException, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type WsResponse,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type {
  BusinessAvailabilityEvent,
  ConversationOperationEvent,
  ConversationRecoveryEvent,
  ConversationResponse,
  ConversationRoutingEvent,
  ConversationWaitOptionsEvent,
  IntakePrompt,
  IntakeSubmitResult,
  ConversationSessionResponse,
  MessagePage,
  MessageReceiptEvent,
  MessageResponse,
  SocketAck,
  TypingEvent,
} from '@bizchat/types';
import {
  conversationHistorySchema,
  conversationResumeSchema,
  conversationStartSchema,
  followUpRequestSchema,
  intakeFormSubmitSchema,
  intakeSubmitSchema,
  messageReadSchema,
  messageReceiptSchema,
  messageSendSchema,
  typingUpdateSchema,
} from '@bizchat/validation';
import {
  CONVERSATION_OPERATION_EVENT,
  MESSAGE_CREATED_EVENT,
  MESSAGE_RECEIPT_EVENT,
  type ConversationOperationApplicationEvent,
  type MessageCreatedApplicationEvent,
  type MessageReceiptApplicationEvent,
} from '../conversations/conversation-events';
import { ConversationService } from '../conversations/conversation.service';
import { WidgetService } from './widget.service';
import { AgentProfileService } from '../agents/agent-profile.service';
import { PresenceService } from '../realtime/presence.service';
import { TypingService } from '../realtime/typing.service';
import {
  AGENT_PRESENCE_EVENT,
  TYPING_CHANGED_EVENT,
  VISITOR_PRESENCE_EVENT,
  type AgentPresenceApplicationEvent,
  type TypingApplicationEvent,
  type VisitorPresenceApplicationEvent,
} from '../realtime/realtime-events';
import {
  CONVERSATION_ROUTED_EVENT,
  CONVERSATION_WAIT_OPTIONS_EVENT,
  type ConversationRoutedApplicationEvent,
  type ConversationWaitOptionsApplicationEvent,
} from '../routing/routing-events';
import { QueueWaitService } from '../routing/queue-wait.service';
import { RedisService } from '../realtime/redis.service';
import { ConversationRoutingService } from '../routing/conversation-routing.service';
import { IntakeService } from '../intake/intake.service';
import {
  INTAKE_REQUIRED_EVENT,
  type IntakeRequiredApplicationEvent,
} from '../intake/intake-events';
import {
  CONVERSATION_RECOVERY_EVENT,
  type ConversationRecoveryApplicationEvent,
} from '../reliability/reliability-events';

interface WidgetSocketData {
  widgetSessionId: string;
  businessId: string;
  visitorId: string;
}

interface WidgetServerEvents {
  'widget.connected': (event: { connectedAt: string; sessionExpiresAt: string }) => void;
  'widget.error': (event: { code: string; message: string }) => void;
  'message.new': (message: MessageResponse) => void;
  'message.receipt': (receipt: MessageReceiptEvent) => void;
  'typing.changed': (event: TypingEvent) => void;
  'business.presence': (event: BusinessAvailabilityEvent) => void;
  'conversation.routed': (event: ConversationRoutingEvent) => void;
  'conversation.updated': (event: ConversationOperationEvent) => void;
  'conversation.recovery': (event: ConversationRecoveryEvent) => void;
  'conversation.intake.required': (event: { conversationId: string; prompt: IntakePrompt }) => void;
  'conversation.wait.options': (event: ConversationWaitOptionsEvent) => void;
}

interface WidgetClientEvents {
  'conversation.start': (
    input: unknown,
    ack: SocketAcknowledger<ConversationSessionResponse>,
  ) => void;
  'conversation.resume': (
    input: unknown,
    ack: SocketAcknowledger<ConversationSessionResponse>,
  ) => void;
  'conversation.intake.submit': (
    input: unknown,
    ack: SocketAcknowledger<IntakeSubmitResult>,
  ) => void;
  'conversation.intake.form': (input: unknown, ack: SocketAcknowledger<IntakeSubmitResult>) => void;
  'conversation.followup.request': (
    input: unknown,
    ack: SocketAcknowledger<ConversationResponse>,
  ) => void;
  'conversation.history': (input: unknown, ack: SocketAcknowledger<MessagePage>) => void;
  'message.send': (input: unknown, ack: SocketAcknowledger<MessageResponse>) => void;
  'message.delivered': (input: unknown, ack: SocketAcknowledger<MessageReceiptEvent>) => void;
  'message.read': (input: unknown, ack: SocketAcknowledger<MessageReceiptEvent[]>) => void;
  'typing.start': (input: unknown, ack: SocketAcknowledger<TypingEvent>) => void;
  'typing.stop': (input: unknown, ack: SocketAcknowledger<TypingEvent>) => void;
}

type SocketAcknowledger<T> = (payload: SocketAck<T>) => void;
type WidgetSocket = Socket<
  WidgetClientEvents,
  WidgetServerEvents,
  Record<string, never>,
  WidgetSocketData
>;
type WidgetServer = Server<
  WidgetClientEvents,
  WidgetServerEvents,
  Record<string, never>,
  WidgetSocketData
>;

@WebSocketGateway({
  namespace: '/widget',
  cors: { origin: true, credentials: false },
  transports: ['websocket', 'polling'],
})
export class WidgetGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(WidgetGateway.name);
  @WebSocketServer() private readonly server!: WidgetServer;

  public constructor(
    private readonly widgets: WidgetService,
    private readonly conversations: ConversationService,
    private readonly presence: PresenceService,
    private readonly typing: TypingService,
    private readonly profiles: AgentProfileService,
    private readonly events: EventEmitter2,
    private readonly routing: ConversationRoutingService,
    private readonly intake: IntakeService,
    private readonly waits: QueueWaitService,
    private readonly redis: RedisService,
  ) {}

  public async handleConnection(client: WidgetSocket): Promise<void> {
    try {
      const auth = client.handshake.auth as { token?: unknown };
      const token = typeof auth.token === 'string' ? auth.token : undefined;
      const session = await this.widgets.authenticateSocket(token, client.handshake.headers.origin);
      client.data = {
        widgetSessionId: session.id,
        businessId: session.businessId,
        visitorId: session.visitorId,
      };
      await client.join(`widget-session:${session.id}`);
      await client.join(this.businessWidgetRoom(session.businessId));
      await this.presence.connectVisitor(session.businessId, session.visitorId, client.id);
      await this.publishVisitorPresence(client.data, 'ONLINE');
      client.emit('widget.connected', {
        connectedAt: new Date().toISOString(),
        sessionExpiresAt: session.expiresAt.toISOString(),
      });
      client.emit('business.presence', {
        ...(await this.profiles.businessAvailability(session.businessId)),
        changedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `Rejected widget socket ${client.id}: ${error instanceof Error ? error.message : 'invalid session'}`,
      );
      client.emit('widget.error', {
        code: 'WIDGET_SESSION_INVALID',
        message: 'Widget session is invalid or expired',
      });
      client.disconnect(true);
    }
  }

  public async handleDisconnect(client: WidgetSocket): Promise<void> {
    if (!client.data.businessId || !client.data.visitorId) return;
    const stillOnline = await this.presence.disconnectVisitor(
      client.data.businessId,
      client.data.visitorId,
      client.id,
    );
    if (!stillOnline) await this.publishVisitorPresence(client.data, 'OFFLINE');
  }

  @SubscribeMessage('widget.heartbeat')
  public async heartbeat(
    @ConnectedSocket() client: WidgetSocket,
  ): Promise<WsResponse<{ serverTime: string }>> {
    await this.widgets.heartbeat(client.data.widgetSessionId);
    await this.presence.refreshVisitor(client.data.businessId, client.data.visitorId, client.id);
    return { event: 'widget.heartbeat.ack', data: { serverTime: new Date().toISOString() } };
  }

  @SubscribeMessage('typing.start') public typingStart(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<TypingEvent>,
  ): Promise<void> {
    return this.updateTyping(client, input, true, acknowledge);
  }
  @SubscribeMessage('typing.stop') public typingStop(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<TypingEvent>,
  ): Promise<void> {
    return this.updateTyping(client, input, false, acknowledge);
  }

  @SubscribeMessage('conversation.start')
  public async start(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<ConversationSessionResponse>,
  ): Promise<void> {
    const parsed = conversationStartSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      const result = await this.conversations.startVisitor(client.data, parsed.data);
      await client.join(this.conversationRoom(client.data.businessId, result.conversation.id));
      await this.publishVisitorPresence(client.data, 'ONLINE');
      // Routing waits while the visitor chooses a topic or completes the pre-chat form.
      if (result.intake?.mode === 'ASK') {
        acknowledge({ ok: true, data: result });
        return;
      }
      const routed = await this.routing.routeConversation(
        client.data.businessId,
        result.conversation.id,
      );
      acknowledge({ ok: true, data: { ...result, conversation: routed.conversation } });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  /** The visitor picks a topic (null = "Something else"), or changes it while still waiting. */
  @SubscribeMessage('conversation.intake.submit')
  public async submitIntake(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<IntakeSubmitResult>,
  ): Promise<void> {
    const parsed = intakeSubmitSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({ ok: true, data: await this.intake.submit(client.data, parsed.data) });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  /** The visitor submits the pre-chat form; field problems come back as `details.fieldErrors`. */
  @SubscribeMessage('conversation.intake.form')
  public async submitIntakeForm(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<IntakeSubmitResult>,
  ): Promise<void> {
    const parsed = intakeFormSubmitSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({ ok: true, data: await this.intake.submitForm(client.data, parsed.data) });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  /** The visitor leaves contact details instead of waiting (after a long wait or outside hours). */
  @SubscribeMessage('conversation.followup.request')
  public async requestFollowUp(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<ConversationResponse>,
  ): Promise<void> {
    const parsed = followUpRequestSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({ ok: true, data: await this.waits.requestFollowUp(client.data, parsed.data) });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @OnEvent(CONVERSATION_WAIT_OPTIONS_EVENT)
  public waitOptions(event: ConversationWaitOptionsApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversationId))
      .emit('conversation.wait.options', {
        conversationId: event.conversationId,
        reason: event.reason,
      });
  }

  @OnEvent(INTAKE_REQUIRED_EVENT)
  public intakeRequired(event: IntakeRequiredApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversationId))
      .emit('conversation.intake.required', {
        conversationId: event.conversationId,
        prompt: event.prompt,
      });
  }

  @SubscribeMessage('conversation.resume')
  public async resume(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<ConversationSessionResponse>,
  ): Promise<void> {
    const parsed = conversationResumeSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      const result = await this.conversations.resumeVisitor(client.data, parsed.data);
      await client.join(this.conversationRoom(client.data.businessId, result.conversation.id));
      await this.publishVisitorPresence(client.data, 'ONLINE');
      acknowledge({ ok: true, data: result });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('conversation.history')
  public async history(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<MessagePage>,
  ): Promise<void> {
    const parsed = conversationHistorySchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({
        ok: true,
        data: await this.conversations.getVisitorHistory(client.data, parsed.data),
      });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('message.send')
  public async send(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<MessageResponse>,
  ): Promise<void> {
    const parsed = messageSendSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({
        ok: true,
        data: await this.conversations.sendVisitor(client.data, parsed.data),
      });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('message.delivered')
  public async delivered(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<MessageReceiptEvent>,
  ): Promise<void> {
    const parsed = messageReceiptSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({
        ok: true,
        data: await this.conversations.markVisitorDelivered(client.data, parsed.data),
      });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('message.read')
  public async read(
    @ConnectedSocket() client: WidgetSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: SocketAcknowledger<MessageReceiptEvent[]>,
  ): Promise<void> {
    const parsed = messageReadSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({
        ok: true,
        data: await this.conversations.markVisitorRead(client.data, parsed.data),
      });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @OnEvent(MESSAGE_CREATED_EVENT)
  public broadcastMessage(event: MessageCreatedApplicationEvent): void {
    if (!event.visitorId || event.message.messageType === 'INTERNAL_NOTE') return;
    this.server
      .to(this.conversationRoom(event.businessId, event.message.conversationId))
      .emit('message.new', event.message);
  }

  @OnEvent(MESSAGE_RECEIPT_EVENT)
  public broadcastReceipt(event: MessageReceiptApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversationId))
      .emit('message.receipt', event.receipt);
  }

  @OnEvent(TYPING_CHANGED_EVENT)
  public broadcastTyping(event: TypingApplicationEvent): void {
    if (event.participantType === 'AGENT')
      this.server
        .to(this.conversationRoom(event.businessId, event.conversationId))
        .emit('typing.changed', event);
  }

  @OnEvent(AGENT_PRESENCE_EVENT)
  public async broadcastAvailability(event: AgentPresenceApplicationEvent): Promise<void> {
    const availability = await this.profiles.businessAvailability(event.businessId);
    // Shared across instances: only a change is broadcast, whichever instance sees it first.
    const summary = `${availability.availability}:${availability.onlineAgents}`;
    const previous = await this.redis
      .set(`widget:availability:${event.businessId}`, summary, 'EX', 3_600, 'GET')
      .catch(() => null);
    if (previous === summary) return;
    this.server
      .to(this.businessWidgetRoom(event.businessId))
      .emit('business.presence', { ...availability, changedAt: new Date().toISOString() });
  }

  @OnEvent(CONVERSATION_ROUTED_EVENT)
  public broadcastRouting(event: ConversationRoutedApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversation.id))
      .emit('conversation.routed', event);
  }

  @OnEvent(CONVERSATION_OPERATION_EVENT)
  public broadcastOperation(event: ConversationOperationApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversation.id))
      .emit('conversation.updated', event);
  }

  @OnEvent(CONVERSATION_RECOVERY_EVENT)
  public broadcastRecovery(event: ConversationRecoveryApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversationId))
      .emit('conversation.recovery', event);
  }

  private conversationRoom(businessId: string, conversationId: string): string {
    return `conversation:${businessId}:${conversationId}:visitor`;
  }

  private businessWidgetRoom(businessId: string): string {
    return `business:${businessId}:widgets`;
  }

  private async updateTyping(
    client: WidgetSocket,
    input: unknown,
    isTyping: boolean,
    acknowledge: SocketAcknowledger<TypingEvent>,
  ): Promise<void> {
    const parsed = typingUpdateSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      await this.conversations.authorizeVisitor(client.data, parsed.data.conversationId);
      const base = {
        conversationId: parsed.data.conversationId,
        participantType: 'VISITOR' as const,
        participantId: client.data.visitorId,
        displayName: null,
      };
      const event = isTyping ? await this.typing.start(base) : await this.typing.stop(base);
      this.events.emit(TYPING_CHANGED_EVENT, {
        ...event,
        businessId: client.data.businessId,
      } satisfies TypingApplicationEvent);
      acknowledge({ ok: true, data: event });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  private async publishVisitorPresence(
    identity: WidgetSocketData,
    state: 'ONLINE' | 'OFFLINE',
  ): Promise<void> {
    const conversationIds = await this.conversations.visitorOpenConversationIds(identity);
    for (const conversationId of conversationIds) {
      this.events.emit(VISITOR_PRESENCE_EVENT, {
        businessId: identity.businessId,
        visitorId: identity.visitorId,
        conversationId,
        state,
        changedAt: new Date().toISOString(),
      } satisfies VisitorPresenceApplicationEvent);
    }
  }

  private failure(error: unknown): SocketAck<never> {
    if (!(error instanceof HttpException))
      this.logger.error(error instanceof Error ? error.stack : String(error));
    return socketFailure(error);
  }
}

function validationFailure(details: unknown): SocketAck<never> {
  return {
    ok: false,
    error: { code: 'VALIDATION_ERROR', message: 'The event payload is invalid', details },
  };
}

function socketFailure(error: unknown): SocketAck<never> {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null) {
      const body = response as { code?: unknown; message?: unknown; details?: unknown };
      return {
        ok: false,
        error: {
          code: typeof body.code === 'string' ? body.code : 'REQUEST_FAILED',
          message: typeof body.message === 'string' ? body.message : 'Request failed',
          // Field-level problems (e.g. pre-chat form answers) let the widget mark each field.
          ...(body.details !== undefined ? { details: body.details } : {}),
        },
      };
    }
  }
  return {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' },
  };
}
