import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type {
  AgentConnectedEvent,
  AgentPresenceEvent,
  ConversationRecoveryEvent,
  ConversationSessionResponse,
  ConversationOperationEvent,
  ConversationRoutingEvent,
  MessageReceiptEvent,
  MessageResponse,
  SocketAck,
  TypingEvent,
  VisitorPresenceEvent,
} from '@bizchat/types';
import {
  agentPresenceUpdateSchema,
  conversationSubscriptionSchema,
  messageReadSchema,
  messageReceiptSchema,
  messageSendSchema,
  typingUpdateSchema,
} from '@bizchat/validation';
import { roleHasPermission } from '../auth/rbac';
import { SESSION_COOKIE } from '../auth/session-auth.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import type { AuthContext } from '../common/http.types';
import type { Environment } from '../config/environment';
import {
  CONVERSATION_CREATED_EVENT,
  CONVERSATION_OPERATION_EVENT,
  MESSAGE_CREATED_EVENT,
  MESSAGE_RECEIPT_EVENT,
  type ConversationCreatedApplicationEvent,
  type ConversationOperationApplicationEvent,
  type MessageCreatedApplicationEvent,
  type MessageReceiptApplicationEvent,
} from '../conversations/conversation-events';
import { ConversationService } from '../conversations/conversation.service';
import {
  AGENT_PRESENCE_EVENT,
  TYPING_CHANGED_EVENT,
  VISITOR_PRESENCE_EVENT,
  type AgentPresenceApplicationEvent,
  type TypingApplicationEvent,
  type VisitorPresenceApplicationEvent,
} from '../realtime/realtime-events';
import { PresenceService } from '../realtime/presence.service';
import { TypingService } from '../realtime/typing.service';
import { AgentProfileService } from './agent-profile.service';
import { ConversationRoutingService } from '../routing/conversation-routing.service';
import {
  CONVERSATION_ROUTED_EVENT,
  type ConversationRoutedApplicationEvent,
} from '../routing/routing-events';
import { ConversationReliabilityService } from '../reliability/conversation-reliability.service';
import {
  CONVERSATION_RECOVERY_EVENT,
  type ConversationRecoveryApplicationEvent,
} from '../reliability/reliability-events';

interface AgentSocketData {
  auth: AuthContext;
  profileId: string;
  manualState: 'ONLINE' | 'BUSY' | 'AWAY' | 'DO_NOT_DISTURB';
}
interface AgentDirectServerEvents {
  'agent.connected': (event: AgentConnectedEvent) => void;
  'agent.error': (event: { code: string; message: string }) => void;
  'visitor.presence': (event: VisitorPresenceEvent) => void;
  'conversation.assigned': (event: ConversationRoutingEvent) => void;
  'conversation.transferred': (event: ConversationOperationEvent) => void;
  'conversation.recovery': (event: ConversationRecoveryEvent) => void;
}
type AgentSocket = Socket<
  Record<string, never>,
  AgentDirectServerEvents,
  Record<string, never>,
  AgentSocketData
>;
type Acknowledger<T> = (payload: SocketAck<T>) => void;

@WebSocketGateway({
  namespace: '/agent',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AgentGateway.name);
  private readonly allowedOrigins: Set<string>;
  @WebSocketServer() private readonly server!: Server;

  public constructor(
    private readonly sessions: SessionAuthenticationService,
    private readonly profiles: AgentProfileService,
    private readonly presence: PresenceService,
    private readonly typing: TypingService,
    private readonly conversations: ConversationService,
    private readonly events: EventEmitter2,
    private readonly routing: ConversationRoutingService,
    private readonly reliability: ConversationReliabilityService,
    config: ConfigService<Environment, true>,
  ) {
    this.allowedOrigins = new Set([
      config.get('DASHBOARD_URL', { infer: true }),
      ...config
        .get('ALLOWED_DEV_ORIGINS', { infer: true })
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ]);
  }

  public async handleConnection(client: AgentSocket): Promise<void> {
    try {
      const origin = client.handshake.headers.origin;
      if (!origin || !this.allowedOrigins.has(origin))
        throw new Error('Untrusted dashboard origin');
      const auth = await this.sessions.authenticate(
        parseCookie(client.handshake.headers.cookie, SESSION_COOKIE),
      );
      const profile = await this.profiles.getOrCreate(auth);
      if (profile.status !== 'ACTIVE') throw new Error('Agent profile disabled');
      client.data = { auth, profileId: profile.id, manualState: 'ONLINE' };
      await client.join(this.agentRoom(auth.business.id, auth.membership.id));
      if (roleHasPermission(auth.membership.role, 'conversation:view_all'))
        await client.join(this.businessRoom(auth.business.id));
      const state = await this.presence.connectAgent(auth.business.id, profile.id, client.id);
      const restoredConversationIds = await this.reliability.agentReconnected(
        auth.business.id,
        auth.membership.id,
      );
      for (const conversationId of restoredConversationIds) {
        await client.join(this.conversationRoom(auth.business.id, conversationId));
      }
      const presenceEvent = await this.profiles.presenceEvent(profile, state);
      this.publishPresence(auth.business.id, presenceEvent);
      const payload: AgentConnectedEvent = {
        connectedAt: new Date().toISOString(),
        profile: await this.profiles.getMine(auth),
        restoredConversationIds,
      };
      client.emit('agent.connected', payload);
      void this.routing.drainForAgent(auth.business.id, profile.id);
    } catch (error) {
      this.logger.warn(
        `Rejected agent socket ${client.id}: ${error instanceof Error ? error.message : 'invalid session'}`,
      );
      client.emit('agent.error', {
        code: 'AGENT_SESSION_INVALID',
        message: 'Agent session is invalid or expired',
      });
      client.disconnect(true);
    }
  }

  public async handleDisconnect(client: AgentSocket): Promise<void> {
    if (!client.data.auth || !client.data.profileId) return;
    const state = await this.presence.disconnectAgent(
      client.data.auth.business.id,
      client.data.profileId,
      client.id,
    );
    if (state === 'OFFLINE') {
      await this.reliability.agentDisconnected(
        client.data.auth.business.id,
        client.data.profileId,
        client.data.auth.membership.id,
      );
    }
    const profile = await this.profiles.getOrCreate(client.data.auth);
    this.publishPresence(
      client.data.auth.business.id,
      await this.profiles.presenceEvent(profile, state),
    );
  }

  @SubscribeMessage('agent.heartbeat')
  public async heartbeat(
    @ConnectedSocket() client: AgentSocket,
    @Ack() acknowledge: Acknowledger<{ serverTime: string; presence: AgentPresenceEvent }>,
  ): Promise<void> {
    try {
      const state = await this.presence.refreshAgent(
        client.data.auth.business.id,
        client.data.profileId,
        client.id,
        client.data.manualState,
      );
      const profile = await this.profiles.getOrCreate(client.data.auth);
      const event = await this.profiles.presenceEvent(profile, state);
      this.publishPresence(client.data.auth.business.id, event);
      if (event.state === 'ONLINE')
        void this.routing.drainForAgent(client.data.auth.business.id, client.data.profileId);
      acknowledge({ ok: true, data: { serverTime: new Date().toISOString(), presence: event } });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('agent.presence.set')
  public async setPresence(
    @ConnectedSocket() client: AgentSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: Acknowledger<AgentPresenceEvent>,
  ): Promise<void> {
    const parsed = agentPresenceUpdateSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      client.data.manualState = parsed.data.state;
      const state = await this.presence.setAgentState(
        client.data.auth.business.id,
        client.data.profileId,
        parsed.data.state,
      );
      await this.presence.refreshAgent(
        client.data.auth.business.id,
        client.data.profileId,
        client.id,
        parsed.data.state,
      );
      const profile = await this.profiles.getOrCreate(client.data.auth);
      const event = await this.profiles.presenceEvent(profile, state);
      this.publishPresence(client.data.auth.business.id, event);
      if (event.state === 'ONLINE')
        void this.routing.drainForAgent(client.data.auth.business.id, client.data.profileId);
      acknowledge({ ok: true, data: event });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('conversation.subscribe')
  public async subscribe(
    @ConnectedSocket() client: AgentSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: Acknowledger<ConversationSessionResponse>,
  ): Promise<void> {
    const parsed = conversationSubscriptionSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      const conversation = await this.conversations.authorizeAgent(
        client.data.auth,
        parsed.data.conversationId,
      );
      const history = await this.conversations.getDashboardHistory(
        client.data.auth,
        parsed.data.conversationId,
        {
          ...(parsed.data.afterSequence ? { afterSequence: parsed.data.afterSequence } : {}),
          limit: 100,
        },
      );
      await client.join(
        this.conversationRoom(client.data.auth.business.id, parsed.data.conversationId),
      );
      const visitorState: VisitorPresenceEvent = {
        conversationId: parsed.data.conversationId,
        state: (await this.conversations.isVisitorOnlineForAgent(
          client.data.auth,
          parsed.data.conversationId,
        ))
          ? 'ONLINE'
          : 'OFFLINE',
        changedAt: new Date().toISOString(),
      };
      client.emit('visitor.presence', visitorState);
      acknowledge({ ok: true, data: { conversation, history } });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('message.send')
  public async send(
    @ConnectedSocket() client: AgentSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: Acknowledger<MessageResponse>,
  ): Promise<void> {
    const parsed = messageSendSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({
        ok: true,
        data: await this.conversations.sendAgent(client.data.auth, parsed.data.conversationId, {
          clientMessageId: parsed.data.clientMessageId,
          content: parsed.data.content,
        }),
      });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('message.delivered')
  public async delivered(
    @ConnectedSocket() client: AgentSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: Acknowledger<MessageReceiptEvent>,
  ): Promise<void> {
    const parsed = messageReceiptSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({
        ok: true,
        data: await this.conversations.markAgentDelivered(client.data.auth, parsed.data),
      });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('message.read')
  public async read(
    @ConnectedSocket() client: AgentSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: Acknowledger<MessageReceiptEvent[]>,
  ): Promise<void> {
    const parsed = messageReadSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      acknowledge({
        ok: true,
        data: await this.conversations.markAgentRead(client.data.auth, parsed.data),
      });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  @SubscribeMessage('typing.start') public typingStart(
    @ConnectedSocket() client: AgentSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: Acknowledger<TypingEvent>,
  ): Promise<void> {
    return this.updateTyping(client, input, true, acknowledge);
  }
  @SubscribeMessage('typing.stop') public typingStop(
    @ConnectedSocket() client: AgentSocket,
    @MessageBody() input: unknown,
    @Ack() acknowledge: Acknowledger<TypingEvent>,
  ): Promise<void> {
    return this.updateTyping(client, input, false, acknowledge);
  }

  @OnEvent(CONVERSATION_CREATED_EVENT)
  public conversationCreated(event: ConversationCreatedApplicationEvent): void {
    this.server
      .to(this.businessRoom(event.businessId))
      .emit('conversation.new', event.conversation);
  }
  @OnEvent(MESSAGE_CREATED_EVENT)
  public messageCreated(event: MessageCreatedApplicationEvent): void {
    this.server
      .to(this.businessRoom(event.businessId))
      .to(this.conversationRoom(event.businessId, event.message.conversationId))
      .emit('message.new', event.message);
  }
  @OnEvent(MESSAGE_RECEIPT_EVENT)
  public receipt(event: MessageReceiptApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversationId))
      .emit('message.receipt', event.receipt);
  }
  @OnEvent(TYPING_CHANGED_EVENT)
  public typingChanged(event: TypingApplicationEvent): void {
    if (event.participantType === 'VISITOR')
      this.server
        .to(this.conversationRoom(event.businessId, event.conversationId))
        .emit('typing.changed', event);
  }
  @OnEvent(VISITOR_PRESENCE_EVENT)
  public visitorPresence(event: VisitorPresenceApplicationEvent): void {
    this.server
      .to(this.conversationRoom(event.businessId, event.conversationId))
      .emit('visitor.presence', event);
  }
  @OnEvent(AGENT_PRESENCE_EVENT)
  public agentPresence(event: AgentPresenceApplicationEvent): void {
    this.server.to(this.businessRoom(event.businessId)).emit('agent.presence', event);
  }
  @OnEvent(CONVERSATION_ROUTED_EVENT)
  public conversationRouted(event: ConversationRoutedApplicationEvent): void {
    this.server.to(this.businessRoom(event.businessId)).emit('conversation.routed', event);
    if (event.outcome === 'ASSIGNED' && event.assignedAgentMembershipId) {
      this.server
        .to(this.agentRoom(event.businessId, event.assignedAgentMembershipId))
        .emit('conversation.assigned', event);
    }
  }
  @OnEvent(CONVERSATION_OPERATION_EVENT)
  public conversationOperation(event: ConversationOperationApplicationEvent): void {
    if (
      event.previousAssignedAgentMembershipId &&
      event.previousAssignedAgentMembershipId !== event.assignedAgentMembershipId
    ) {
      this.server
        .in(this.agentRoom(event.businessId, event.previousAssignedAgentMembershipId))
        .socketsLeave(this.conversationRoom(event.businessId, event.conversation.id));
    }
    this.server.to(this.businessRoom(event.businessId)).emit('conversation.operation', event);
    if (event.operation === 'TRANSFERRED' && event.assignedAgentMembershipId) {
      this.server
        .to(this.agentRoom(event.businessId, event.assignedAgentMembershipId))
        .emit('conversation.transferred', event);
    }
  }

  @OnEvent(CONVERSATION_RECOVERY_EVENT)
  public conversationRecovery(event: ConversationRecoveryApplicationEvent): void {
    const rooms = this.server.to(this.businessRoom(event.businessId));
    if (event.assignedAgentMembershipId)
      rooms.to(this.agentRoom(event.businessId, event.assignedAgentMembershipId));
    rooms.emit('conversation.recovery', event);
  }

  private async updateTyping(
    client: AgentSocket,
    input: unknown,
    typing: boolean,
    acknowledge: Acknowledger<TypingEvent>,
  ): Promise<void> {
    const parsed = typingUpdateSchema.safeParse(input);
    if (!parsed.success) {
      acknowledge(validationFailure(parsed.error.flatten()));
      return;
    }
    try {
      await this.conversations.authorizeAgent(client.data.auth, parsed.data.conversationId);
      const base = {
        conversationId: parsed.data.conversationId,
        participantType: 'AGENT' as const,
        participantId: client.data.auth.user.id,
        displayName: client.data.auth.user.displayName,
      };
      const event = typing ? await this.typing.start(base) : await this.typing.stop(base);
      this.events.emit(TYPING_CHANGED_EVENT, {
        ...event,
        businessId: client.data.auth.business.id,
      } satisfies TypingApplicationEvent);
      acknowledge({ ok: true, data: event });
    } catch (error) {
      acknowledge(this.failure(error));
    }
  }

  private publishPresence(businessId: string, event: AgentPresenceEvent): void {
    this.events.emit(AGENT_PRESENCE_EVENT, {
      ...event,
      businessId,
    } satisfies AgentPresenceApplicationEvent);
  }
  private businessRoom(id: string): string {
    return `business:${id}:agents:all`;
  }
  private agentRoom(businessId: string, membershipId: string): string {
    return `business:${businessId}:agent:${membershipId}`;
  }
  private conversationRoom(businessId: string, conversationId: string): string {
    return `conversation:${businessId}:${conversationId}:agents`;
  }
  private failure(error: unknown): SocketAck<never> {
    if (!(error instanceof HttpException))
      this.logger.error(error instanceof Error ? error.stack : String(error));
    return socketFailure(error);
  }
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
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
    if (typeof response === 'object' && response) {
      const body = response as { code?: unknown; message?: unknown };
      return {
        ok: false,
        error: {
          code: typeof body.code === 'string' ? body.code : 'REQUEST_FAILED',
          message: typeof body.message === 'string' ? body.message : 'Request failed',
        },
      };
    }
  }
  return {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed' },
  };
}
