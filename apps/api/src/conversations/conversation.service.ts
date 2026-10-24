import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  type Conversation,
  type ConversationEvent,
  type Message,
  type MessageReceipt,
} from '@prisma/client';
import type {
  ConversationPage,
  ConversationResponse,
  ConversationSessionResponse,
  MessagePage,
  MessageReceiptEvent,
  MessageResponse,
} from '@bizchat/types';
import type {
  AgentMessageSendInput,
  AttachmentMessageInput,
  ConversationHistoryInput,
  ConversationListQuery,
  ConversationResumeInput,
  ConversationStatusUpdateInput,
  ConversationStartInput,
  MessageHistoryQuery,
  MessageReadInput,
  MessageReceiptInput,
  MessageSendInput,
} from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { PrismaService } from '../database/prisma.service';
import { roleHasPermission } from '../auth/rbac';
import {
  CONVERSATION_CREATED_EVENT,
  CONVERSATION_OPERATION_EVENT,
  MESSAGE_CREATED_EVENT,
  MESSAGE_RECEIPT_EVENT,
  type ConversationCreatedApplicationEvent,
  type ConversationOperationApplicationEvent,
  type MessageCreatedApplicationEvent,
  type MessageReceiptApplicationEvent,
} from './conversation-events';
import { serializeConversation, serializeMessage } from './conversation-serializer';
import { ConversationStateService } from './conversation-state';
import { PresenceService } from '../realtime/presence.service';
import { MessageService } from './message.service';
import {
  CONVERSATION_CAPACITY_RELEASED_EVENT,
  type ConversationCapacityReleasedApplicationEvent,
} from '../routing/routing-events';
import { ConversationTimelineService } from './conversation-timeline.service';
import { ConversationRoutingService } from '../routing/conversation-routing.service';
import { IntakeService } from '../intake/intake.service';
import { classificationRecord, TopicCatalogService } from '../intake/topic-catalog.service';

const OPEN_VISITOR_STATUSES = [
  'NEW',
  'QUEUED',
  'OFFERED',
  'ASSIGNED',
  'ACTIVE',
  'WAITING_FOR_CUSTOMER',
  'WAITING_FOR_AGENT',
] as const;

/** A consultant can preview an offered conversation but must accept before replying. */
function assertNotOffered(conversation: Conversation): void {
  if (conversation.status === 'OFFERED')
    throw new ConflictException({
      code: 'OFFER_NOT_ACCEPTED',
      message: 'Accept this chat before replying',
    });
}

interface VisitorIdentity {
  businessId: string;
  visitorId: string;
}
export interface AttachmentMessageCommand extends AttachmentMessageInput {
  conversationId: string;
  attachment: {
    uploadedByType: 'BUSINESS_USER' | 'VISITOR';
    uploadedById: string;
    originalFileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    status: 'READY';
  };
}

export interface AttachmentSendResult {
  message: MessageResponse;
  created: boolean;
}

@Injectable()
export class ConversationService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageService,
    private readonly events: EventEmitter2,
    private readonly states: ConversationStateService,
    private readonly presence: PresenceService,
    private readonly timeline: ConversationTimelineService,
    private readonly routing: ConversationRoutingService,
    private readonly topics: TopicCatalogService,
    private readonly intake: IntakeService,
  ) {}

  public async startVisitor(
    identity: VisitorIdentity,
    input: ConversationStartInput,
  ): Promise<ConversationSessionResponse> {
    const previous = await this.prisma.message.findFirst({
      where: {
        businessId: identity.businessId,
        senderVisitorId: identity.visitorId,
        clientMessageId: input.clientMessageId,
      },
      include: { conversation: true, receipts: true },
    });
    if (previous) return this.sessionResponse(identity, previous.conversation, previous);

    // Decided before the transaction (it needs only the message and the cached topic catalogue) and
    // used only if this message starts a new conversation. An explicit department skips topics.
    const intake = input.departmentPublicId
      ? null
      : await this.topics.decide(identity.businessId, input.content, {
          ...(input.topicPublicId ? { topicPublicId: input.topicPublicId } : {}),
          canAsk: true,
        });

    let outcome: {
      conversation: Conversation;
      message: Message & { receipts: MessageReceipt[] };
      messageCreated: boolean;
      conversationCreated: boolean;
      conversationReopened: boolean;
      previousAssignedAgentMembershipId: string | null;
      timeline: {
        event: ConversationEvent;
        message: (Message & { receipts: MessageReceipt[] }) | null;
      } | null;
    };
    try {
      outcome = await this.prisma.$transaction(async (transaction) => {
        const lockKey = `${identity.businessId}:${identity.visitorId}`;
        await transaction.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS acquired
        `;
        const duplicate = await transaction.message.findFirst({
          where: {
            businessId: identity.businessId,
            senderVisitorId: identity.visitorId,
            clientMessageId: input.clientMessageId,
          },
          include: { conversation: true, receipts: true },
        });
        if (duplicate)
          return {
            conversation: duplicate.conversation,
            message: duplicate,
            messageCreated: false,
            conversationCreated: false,
            conversationReopened: false,
            previousAssignedAgentMembershipId: null,
            timeline: null,
          };

        let conversation = await transaction.conversation.findFirst({
          where: {
            businessId: identity.businessId,
            visitorId: identity.visitorId,
            status: { in: [...OPEN_VISITOR_STATUSES] },
          },
          orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
        });
        let conversationCreated = false;
        let conversationReopened = false;
        let previousAssignedAgentMembershipId: string | null = null;
        let timeline: {
          event: ConversationEvent;
          message: (Message & { receipts: MessageReceipt[] }) | null;
        } | null = null;
        if (!conversation) {
          const settings = await transaction.widgetSettings.findUnique({
            where: { businessId: identity.businessId },
            select: { reopenWindowMinutes: true },
          });
          const recentResolved = await transaction.conversation.findFirst({
            where: {
              businessId: identity.businessId,
              visitorId: identity.visitorId,
              status: 'RESOLVED',
              resolvedAt: {
                gte: new Date(Date.now() - (settings?.reopenWindowMinutes ?? 1_440) * 60_000),
              },
            },
            orderBy: { resolvedAt: 'desc' },
          });
          if (recentResolved) {
            previousAssignedAgentMembershipId = recentResolved.assignedAgentMembershipId;
            if (recentResolved.assignedAgentMembershipId) {
              const previousProfile = await transaction.agentProfile.findUnique({
                where: { membershipId: recentResolved.assignedAgentMembershipId },
                select: { userId: true },
              });
              if (previousProfile)
                await transaction.conversationParticipant.updateMany({
                  where: {
                    conversationId: recentResolved.id,
                    participantType: 'AGENT',
                    participantId: previousProfile.userId,
                    leftAt: null,
                  },
                  data: { leftAt: new Date() },
                });
            }
            conversation = await transaction.conversation.update({
              where: { id: recentResolved.id },
              data: {
                status: 'NEW',
                assignedAgentMembershipId: null,
                assignedAt: null,
                resolvedAt: null,
                reopenedAt: new Date(),
              },
            });
            timeline = await this.timeline.recordInTransaction(transaction, {
              businessId: identity.businessId,
              conversationId: conversation.id,
              type: 'REOPENED',
              actorType: 'VISITOR',
              actorId: identity.visitorId,
              metadata: { previousAgentMembershipId: previousAssignedAgentMembershipId },
              systemMessage: 'Conversation reopened.',
            });
            conversationReopened = true;
          } else {
            const department = input.departmentPublicId
              ? await transaction.department.findFirst({
                  where: {
                    businessId: identity.businessId,
                    publicId: input.departmentPublicId,
                    status: 'ACTIVE',
                  },
                })
              : intake?.routing.departmentId
                ? { id: intake.routing.departmentId }
                : await transaction.department.findFirst({
                    where: { businessId: identity.businessId, status: 'ACTIVE', isDefault: true },
                  });
            if (input.departmentPublicId && !department)
              throw new NotFoundException({
                code: 'DEPARTMENT_NOT_FOUND',
                message: 'The selected department is unavailable',
              });
            conversation = await transaction.conversation.create({
              data: {
                businessId: identity.businessId,
                visitorId: identity.visitorId,
                source: 'WEB_WIDGET',
                departmentId: department?.id,
                ...(intake
                  ? {
                      topicId: intake.routing.topicId,
                      priority: intake.routing.priority,
                      requiredSkillId: intake.routing.requiredSkillId,
                      requiredSkillMinProficiency: intake.routing.requiredSkillMinProficiency,
                      intakeStatus: intake.intakeStatus,
                      intakeExpiresAt: intake.intakeExpiresAt,
                    }
                  : {}),
                participants: {
                  create: {
                    businessId: identity.businessId,
                    participantType: 'VISITOR',
                    participantId: identity.visitorId,
                  },
                },
              },
            });
            timeline = await this.timeline.recordInTransaction(transaction, {
              businessId: identity.businessId,
              conversationId: conversation.id,
              type: 'CREATED',
              actorType: 'VISITOR',
              actorId: identity.visitorId,
              metadata: { source: 'WEB_WIDGET', departmentId: department?.id ?? null },
            });
            if (intake)
              await transaction.conversationClassification.create({
                data: classificationRecord(identity.businessId, conversation.id, intake),
              });
            conversationCreated = true;
          }
        }
        const created = await this.messages.createInTransaction(transaction, {
          businessId: identity.businessId,
          conversationId: conversation.id,
          senderType: 'VISITOR',
          senderVisitorId: identity.visitorId,
          clientMessageId: input.clientMessageId,
          content: input.content,
        });
        return {
          conversation,
          message: created.message,
          messageCreated: created.created,
          conversationCreated,
          conversationReopened,
          previousAssignedAgentMembershipId,
          timeline,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicate = await this.prisma.message.findFirst({
          where: {
            businessId: identity.businessId,
            senderVisitorId: identity.visitorId,
            clientMessageId: input.clientMessageId,
          },
          include: { conversation: true, receipts: true },
        });
        if (duplicate) return this.sessionResponse(identity, duplicate.conversation, duplicate);
      }
      throw error;
    }
    if (outcome.conversationCreated) this.publishConversation(identity, outcome.conversation);
    if (outcome.timeline?.message)
      this.publishMessage(outcome.timeline.message, outcome.conversation.visitorId);
    if (outcome.messageCreated)
      this.publishMessage(outcome.message, outcome.conversation.visitorId);
    if (outcome.conversationReopened && outcome.timeline) {
      const response = await this.conversationResponse(outcome.conversation);
      this.events.emit(CONVERSATION_OPERATION_EVENT, {
        businessId: identity.businessId,
        visitorId: identity.visitorId,
        conversation: response,
        event: this.timeline.serialize(outcome.timeline.event),
        operation: 'REOPENED',
        previousAssignedAgentMembershipId: outcome.previousAssignedAgentMembershipId,
        assignedAgentMembershipId: null,
      } satisfies ConversationOperationApplicationEvent);
    }
    const response = await this.sessionResponse(identity, outcome.conversation, outcome.message);
    // A new conversation's prompt lists the best-matching topics first.
    const prompt = outcome.conversationCreated ? this.intake.prompt(intake) : undefined;
    return prompt ? { ...response, intake: prompt } : response;
  }

  public async sendVisitor(
    identity: VisitorIdentity,
    input: MessageSendInput,
  ): Promise<MessageResponse> {
    let conversation = await this.findVisitorConversation(identity, input.conversationId);
    if (conversation.status === 'RESOLVED')
      conversation = await this.reopenVisitorConversation(identity, conversation);
    const result = await this.messages.append({
      businessId: identity.businessId,
      conversationId: conversation.id,
      senderType: 'VISITOR',
      senderVisitorId: identity.visitorId,
      clientMessageId: input.clientMessageId,
      content: input.content,
    });
    if (result.created) this.publishMessage(result.message, identity.visitorId);
    return serializeMessage(result.message);
  }

  public async sendVisitorAttachment(
    identity: VisitorIdentity,
    input: AttachmentMessageCommand,
  ): Promise<AttachmentSendResult> {
    let conversation = await this.findVisitorConversation(identity, input.conversationId);
    if (conversation.status === 'RESOLVED')
      conversation = await this.reopenVisitorConversation(identity, conversation);
    const result = await this.messages.append({
      businessId: identity.businessId,
      conversationId: conversation.id,
      senderType: 'VISITOR',
      senderVisitorId: identity.visitorId,
      clientMessageId: input.clientMessageId,
      messageType: input.attachment.mimeType.startsWith('image/') ? 'IMAGE' : 'FILE',
      content: input.content || input.attachment.originalFileName,
      attachment: input.attachment,
    });
    if (result.created) this.publishMessage(result.message, identity.visitorId);
    return { message: serializeMessage(result.message), created: result.created };
  }

  public async resumeVisitor(
    identity: VisitorIdentity,
    input: ConversationResumeInput,
  ): Promise<ConversationSessionResponse> {
    const conversation = await this.findVisitorConversation(identity, input.conversationId);
    const history = await this.history(
      identity.businessId,
      conversation.id,
      {
        ...(input.afterSequence ? { afterSequence: input.afterSequence } : {}),
        limit: input.limit,
      },
      true,
    );
    const intake = await this.intake.pendingPrompt(conversation);
    return {
      conversation: await this.conversationResponse(conversation),
      history,
      ...(intake ? { intake } : {}),
    };
  }

  public async getVisitorHistory(
    identity: VisitorIdentity,
    input: ConversationHistoryInput,
  ): Promise<MessagePage> {
    const conversation = await this.findVisitorConversation(identity, input.conversationId);
    return this.history(
      identity.businessId,
      conversation.id,
      { beforeSequence: input.beforeSequence, limit: input.limit },
      true,
    );
  }

  public async sendAgent(
    auth: AuthContext,
    conversationId: string,
    input: AgentMessageSendInput,
  ): Promise<MessageResponse> {
    let conversation = await this.findDashboardConversation(auth, conversationId);
    assertNotOffered(conversation);
    if (conversation.status === 'ASSIGNED') {
      conversation = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.conversation.update({
          where: { id: conversation.id, businessId: auth.business.id, status: 'ASSIGNED' },
          data: { status: 'ACTIVE' },
        });
        await this.timeline.recordInTransaction(transaction, {
          businessId: auth.business.id,
          conversationId,
          type: 'ACCEPTED',
          actorType: 'BUSINESS_USER',
          actorId: auth.user.id,
          metadata: { actorName: auth.user.displayName },
        });
        return updated;
      });
    }
    await this.prisma.conversationParticipant.upsert({
      where: {
        conversationId_participantType_participantId: {
          conversationId,
          participantType: 'AGENT',
          participantId: auth.user.id,
        },
      },
      update: { leftAt: null },
      create: {
        businessId: auth.business.id,
        conversationId,
        participantType: 'AGENT',
        participantId: auth.user.id,
      },
    });
    const result = await this.messages.append({
      businessId: auth.business.id,
      conversationId,
      senderType: 'AGENT',
      senderUserId: auth.user.id,
      clientMessageId: input.clientMessageId,
      content: input.content,
    });
    if (result.created) this.publishMessage(result.message, conversation.visitorId);
    return serializeMessage(result.message);
  }

  public async sendAgentAttachment(
    auth: AuthContext,
    conversationId: string,
    input: AttachmentMessageCommand,
  ): Promise<AttachmentSendResult> {
    let conversation = await this.findDashboardConversation(auth, conversationId);
    assertNotOffered(conversation);
    if (conversation.status === 'ASSIGNED') {
      conversation = await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.conversation.update({
          where: { id: conversation.id, businessId: auth.business.id, status: 'ASSIGNED' },
          data: { status: 'ACTIVE' },
        });
        await this.timeline.recordInTransaction(transaction, {
          businessId: auth.business.id,
          conversationId,
          type: 'ACCEPTED',
          actorType: 'BUSINESS_USER',
          actorId: auth.user.id,
          metadata: { actorName: auth.user.displayName },
        });
        return updated;
      });
    }
    if (conversation.status === 'RESOLVED')
      throw new ConflictException({
        code: 'USE_REOPEN_OPERATION',
        message: 'Reopen this conversation before replying',
      });
    await this.prisma.conversationParticipant.upsert({
      where: {
        conversationId_participantType_participantId: {
          conversationId,
          participantType: 'AGENT',
          participantId: auth.user.id,
        },
      },
      update: { leftAt: null },
      create: {
        businessId: auth.business.id,
        conversationId,
        participantType: 'AGENT',
        participantId: auth.user.id,
      },
    });
    const result = await this.messages.append({
      businessId: auth.business.id,
      conversationId,
      senderType: 'AGENT',
      senderUserId: auth.user.id,
      clientMessageId: input.clientMessageId,
      messageType: input.attachment.mimeType.startsWith('image/') ? 'IMAGE' : 'FILE',
      content: input.content || input.attachment.originalFileName,
      attachment: input.attachment,
    });
    if (result.created) this.publishMessage(result.message, conversation.visitorId);
    return { message: serializeMessage(result.message), created: result.created };
  }

  public async updateStatus(
    auth: AuthContext,
    conversationId: string,
    input: ConversationStatusUpdateInput,
  ): Promise<ConversationResponse> {
    const conversation = await this.findDashboardConversation(auth, conversationId);
    if (conversation.status === 'RESOLVED' && input.status === 'ACTIVE')
      throw new ConflictException({
        code: 'USE_REOPEN_OPERATION',
        message: 'Use the reopen operation for resolved conversations',
      });
    this.states.assertTransition(conversation.status, input.status);
    if (conversation.status === input.status) return serializeConversation(conversation);
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.conversation.update({
        where: { id: conversation.id, businessId: auth.business.id, status: conversation.status },
        data: { status: input.status, ...this.states.timestampData(input.status) },
      });
      if (input.status === 'RESOLVED') {
        await transaction.conversationAssignment.updateMany({
          where: { businessId: auth.business.id, conversationId, releasedAt: null },
          data: { releasedAt: new Date(), reason: 'Conversation resolved' },
        });
      }
      const timeline =
        input.status === 'RESOLVED' || input.status === 'CLOSED'
          ? await this.timeline.recordInTransaction(transaction, {
              businessId: auth.business.id,
              conversationId,
              type: input.status,
              actorType: 'BUSINESS_USER',
              actorId: auth.user.id,
              metadata: { actorName: auth.user.displayName },
              systemMessage:
                input.status === 'RESOLVED'
                  ? 'Conversation marked resolved.'
                  : 'Conversation closed.',
            })
          : null;
      return { conversation: result, timeline };
    });
    if (input.status === 'RESOLVED')
      this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
        businessId: auth.business.id,
        agentMembershipId: conversation.assignedAgentMembershipId,
        conversationId,
      } satisfies ConversationCapacityReleasedApplicationEvent);
    if (outcome.timeline?.message)
      this.publishMessage(outcome.timeline.message, conversation.visitorId);
    const response = await this.conversationResponse(outcome.conversation);
    if (outcome.timeline && input.status === 'RESOLVED')
      this.events.emit(CONVERSATION_OPERATION_EVENT, {
        businessId: auth.business.id,
        visitorId: conversation.visitorId,
        conversation: response,
        event: this.timeline.serialize(outcome.timeline.event),
        operation: 'RESOLVED',
        previousAssignedAgentMembershipId: conversation.assignedAgentMembershipId,
        assignedAgentMembershipId: conversation.assignedAgentMembershipId,
      } satisfies ConversationOperationApplicationEvent);
    return response;
  }

  public async listDashboard(
    auth: AuthContext,
    query: ConversationListQuery,
  ): Promise<ConversationPage> {
    const where: Prisma.ConversationWhereInput = {
      businessId: auth.business.id,
      ...(query.status ? { status: query.status } : {}),
      ...(roleHasPermission(auth.membership.role, 'conversation:view_all')
        ? {}
        : { assignedAgentMembershipId: auth.membership.id }),
    };
    const conversations = await this.prisma.conversation.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: {
        messages: {
          where: { messageType: { notIn: ['INTERNAL_NOTE', 'SYSTEM_EVENT'] } },
          orderBy: { sequenceNumber: 'desc' },
          take: 1,
        },
        department: { select: { name: true } },
        queueEntry: true,
        tags: { include: { tag: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    const hasMore = conversations.length > query.limit;
    const selected = conversations.slice(0, query.limit);
    const responses = await Promise.all(
      selected.map(async (conversation) => {
        const unreadCount = await this.prisma.message.count({
          where: {
            businessId: auth.business.id,
            conversationId: conversation.id,
            senderType: { in: ['VISITOR', 'CUSTOMER'] },
            receipts: {
              none: {
                participantType: 'AGENT',
                participantId: auth.user.id,
                readAt: { not: null },
              },
            },
          },
        });
        const queuePosition =
          conversation.status === 'QUEUED' && conversation.queueEntry
            ? await this.queuePosition(conversation.queueEntry)
            : null;
        return {
          ...serializeConversation(conversation),
          departmentName: conversation.department?.name ?? null,
          queuedAt:
            conversation.status === 'QUEUED'
              ? (conversation.queueEntry?.enqueuedAt.toISOString() ?? null)
              : null,
          queuePosition,
          tags: conversation.tags.map(({ tag }) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            status: tag.status,
            createdAt: tag.createdAt.toISOString(),
            updatedAt: tag.updatedAt.toISOString(),
          })),
          lastMessagePreview: conversation.messages[0]?.content?.slice(0, 160) ?? null,
          unreadCount,
        };
      }),
    );
    return { conversations: responses, nextCursor: hasMore ? (selected.at(-1)?.id ?? null) : null };
  }

  public async getDashboardConversation(
    auth: AuthContext,
    id: string,
  ): Promise<ConversationResponse> {
    return this.conversationResponse(await this.findDashboardConversation(auth, id));
  }

  public async getDashboardHistory(
    auth: AuthContext,
    conversationId: string,
    query: MessageHistoryQuery,
  ): Promise<MessagePage> {
    await this.findDashboardConversation(auth, conversationId);
    return this.history(auth.business.id, conversationId, query, false);
  }

  public async markVisitorDelivered(
    identity: VisitorIdentity,
    input: MessageReceiptInput,
  ): Promise<MessageReceiptEvent> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        businessId: identity.businessId,
        conversation: { visitorId: identity.visitorId },
        messageType: { not: 'INTERNAL_NOTE' },
      },
    });
    if (!message)
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    const now = new Date();
    await this.prisma.messageReceipt.upsert({
      where: {
        messageId_participantType_participantId: {
          messageId: message.id,
          participantType: 'VISITOR',
          participantId: identity.visitorId,
        },
      },
      update: { deliveredAt: now },
      create: {
        businessId: identity.businessId,
        messageId: message.id,
        participantType: 'VISITOR',
        participantId: identity.visitorId,
        deliveredAt: now,
      },
    });
    return this.publishReceipt(
      identity.businessId,
      input.conversationId,
      message.id,
      'DELIVERED',
      now,
    );
  }

  public async markVisitorRead(
    identity: VisitorIdentity,
    input: MessageReadInput,
  ): Promise<MessageReceiptEvent[]> {
    await this.findVisitorConversation(identity, input.conversationId);
    const messages = await this.prisma.message.findMany({
      where: {
        businessId: identity.businessId,
        conversationId: input.conversationId,
        sequenceNumber: { lte: BigInt(input.throughSequence) },
        senderType: { in: ['AGENT', 'SYSTEM', 'INTEGRATION'] },
        messageType: { not: 'INTERNAL_NOTE' },
      },
      select: { id: true },
    });
    const now = new Date();
    await this.prisma.$transaction(
      messages.map((message) =>
        this.prisma.messageReceipt.upsert({
          where: {
            messageId_participantType_participantId: {
              messageId: message.id,
              participantType: 'VISITOR',
              participantId: identity.visitorId,
            },
          },
          update: { deliveredAt: now, readAt: now },
          create: {
            businessId: identity.businessId,
            messageId: message.id,
            participantType: 'VISITOR',
            participantId: identity.visitorId,
            deliveredAt: now,
            readAt: now,
          },
        }),
      ),
    );
    return messages.map((message) =>
      this.publishReceipt(identity.businessId, input.conversationId, message.id, 'READ', now),
    );
  }

  public async markAgentDelivered(
    auth: AuthContext,
    input: MessageReceiptInput,
  ): Promise<MessageReceiptEvent> {
    await this.findDashboardConversation(auth, input.conversationId);
    const message = await this.prisma.message.findFirst({
      where: {
        id: input.messageId,
        conversationId: input.conversationId,
        businessId: auth.business.id,
        senderType: { in: ['VISITOR', 'CUSTOMER'] },
      },
    });
    if (!message)
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    const now = new Date();
    await this.prisma.messageReceipt.upsert({
      where: {
        messageId_participantType_participantId: {
          messageId: message.id,
          participantType: 'AGENT',
          participantId: auth.user.id,
        },
      },
      update: { deliveredAt: now },
      create: {
        businessId: auth.business.id,
        messageId: message.id,
        participantType: 'AGENT',
        participantId: auth.user.id,
        deliveredAt: now,
      },
    });
    return this.publishReceipt(
      auth.business.id,
      input.conversationId,
      message.id,
      'DELIVERED',
      now,
    );
  }

  public async markAgentRead(
    auth: AuthContext,
    input: MessageReadInput,
  ): Promise<MessageReceiptEvent[]> {
    await this.findDashboardConversation(auth, input.conversationId);
    const messages = await this.prisma.message.findMany({
      where: {
        businessId: auth.business.id,
        conversationId: input.conversationId,
        sequenceNumber: { lte: BigInt(input.throughSequence) },
        senderType: { in: ['VISITOR', 'CUSTOMER'] },
      },
      select: { id: true },
    });
    const now = new Date();
    await this.prisma.$transaction(
      messages.map((message) =>
        this.prisma.messageReceipt.upsert({
          where: {
            messageId_participantType_participantId: {
              messageId: message.id,
              participantType: 'AGENT',
              participantId: auth.user.id,
            },
          },
          update: { deliveredAt: now, readAt: now },
          create: {
            businessId: auth.business.id,
            messageId: message.id,
            participantType: 'AGENT',
            participantId: auth.user.id,
            deliveredAt: now,
            readAt: now,
          },
        }),
      ),
    );
    return messages.map((message) =>
      this.publishReceipt(auth.business.id, input.conversationId, message.id, 'READ', now),
    );
  }

  public async authorizeAgent(
    auth: AuthContext,
    conversationId: string,
  ): Promise<ConversationResponse> {
    return this.conversationResponse(await this.findDashboardConversation(auth, conversationId));
  }

  public async authorizeVisitor(
    identity: VisitorIdentity,
    conversationId: string,
  ): Promise<ConversationResponse> {
    return this.conversationResponse(await this.findVisitorConversation(identity, conversationId));
  }

  public async authorizeDashboard(auth: AuthContext, conversationId: string): Promise<void> {
    await this.findDashboardConversation(auth, conversationId);
  }

  public async visitorOpenConversationIds(identity: VisitorIdentity): Promise<string[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        businessId: identity.businessId,
        visitorId: identity.visitorId,
        status: { in: [...OPEN_VISITOR_STATUSES] },
      },
      select: { id: true },
    });
    return conversations.map((conversation) => conversation.id);
  }

  public async isVisitorOnlineForAgent(
    auth: AuthContext,
    conversationId: string,
  ): Promise<boolean> {
    const conversation = await this.findDashboardConversation(auth, conversationId);
    return conversation.visitorId
      ? this.presence.isVisitorOnline(auth.business.id, conversation.visitorId)
      : false;
  }

  private async sessionResponse(
    identity: VisitorIdentity,
    conversation: Conversation,
    message?: Message & { receipts?: MessageReceipt[] },
  ): Promise<ConversationSessionResponse> {
    const history = await this.history(identity.businessId, conversation.id, { limit: 50 }, true);
    const intake = await this.intake.pendingPrompt(conversation);
    return {
      conversation: await this.conversationResponse(conversation),
      ...(message ? { message: serializeMessage(message) } : {}),
      history,
      ...(intake ? { intake } : {}),
    };
  }

  private async history(
    businessId: string,
    conversationId: string,
    query: MessageHistoryQuery,
    visitorSafe: boolean,
  ): Promise<MessagePage> {
    const after = query.afterSequence ? BigInt(query.afterSequence) : undefined;
    const before = query.beforeSequence ? BigInt(query.beforeSequence) : undefined;
    const ascending = after !== undefined;
    const messages = await this.prisma.message.findMany({
      where: {
        businessId,
        conversationId,
        ...(visitorSafe ? { messageType: { not: 'INTERNAL_NOTE' as const } } : {}),
        ...(after !== undefined
          ? { sequenceNumber: { gt: after } }
          : before !== undefined
            ? { sequenceNumber: { lt: before } }
            : {}),
      },
      include: {
        receipts: true,
        attachments: { where: { status: 'READY' }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { sequenceNumber: ascending ? 'asc' : 'desc' },
      take: query.limit + 1,
    });
    const hasMore = messages.length > query.limit;
    const selected = messages.slice(0, query.limit);
    if (!ascending) selected.reverse();
    const serialized = selected.map(serializeMessage);
    return {
      messages: serialized,
      hasMore,
      oldestSequence: serialized[0]?.sequenceNumber ?? null,
      latestSequence: serialized.at(-1)?.sequenceNumber ?? null,
    };
  }

  private async findVisitorConversation(
    identity: VisitorIdentity,
    id: string,
  ): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        businessId: identity.businessId,
        visitorId: identity.visitorId,
        status: { not: 'CLOSED' },
      },
    });
    if (!conversation)
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    return conversation;
  }

  private async findDashboardConversation(auth: AuthContext, id: string): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        businessId: auth.business.id,
        ...(roleHasPermission(auth.membership.role, 'conversation:view_all')
          ? {}
          : { assignedAgentMembershipId: auth.membership.id }),
      },
    });
    if (!conversation)
      throw new ForbiddenException({
        code: 'CONVERSATION_ACCESS_DENIED',
        message: 'Conversation is unavailable',
      });
    return conversation;
  }

  private publishConversation(identity: VisitorIdentity, conversation: Conversation): void {
    const event: ConversationCreatedApplicationEvent = {
      businessId: identity.businessId,
      visitorId: identity.visitorId,
      conversation: serializeConversation(conversation),
    };
    this.events.emit(CONVERSATION_CREATED_EVENT, event);
  }

  private async conversationResponse(conversation: Conversation): Promise<ConversationResponse> {
    const [department, queueEntry, tags] = await Promise.all([
      conversation.departmentId
        ? this.prisma.department.findUnique({
            where: { id: conversation.departmentId },
            select: { name: true },
          })
        : null,
      conversation.status === 'QUEUED'
        ? this.prisma.conversationQueueEntry.findUnique({
            where: { conversationId: conversation.id },
          })
        : null,
      this.prisma.conversationTag.findMany({
        where: { businessId: conversation.businessId, conversationId: conversation.id },
        include: { tag: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      ...serializeConversation(conversation),
      departmentName: department?.name ?? null,
      queuedAt: queueEntry?.enqueuedAt.toISOString() ?? null,
      queuePosition: queueEntry ? await this.queuePosition(queueEntry) : null,
      tags: tags.map(({ tag }) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        status: tag.status,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      })),
    };
  }

  private async reopenVisitorConversation(
    identity: VisitorIdentity,
    conversation: Conversation,
  ): Promise<Conversation> {
    if (!conversation.resolvedAt)
      throw new ConflictException({
        code: 'CONVERSATION_NOT_REOPENABLE',
        message: 'Conversation cannot be reopened',
      });
    const settings = await this.prisma.widgetSettings.findUnique({
      where: { businessId: identity.businessId },
      select: { reopenWindowMinutes: true },
    });
    const cutoff = new Date(Date.now() - (settings?.reopenWindowMinutes ?? 1_440) * 60_000);
    if (conversation.resolvedAt < cutoff)
      throw new ConflictException({
        code: 'REOPEN_WINDOW_EXPIRED',
        message: 'Please start a new conversation',
      });
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`visitor-reopen:${identity.businessId}:${conversation.id}`}, 0)) IS NULL AS acquired`;
      const current = await transaction.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      if (current.status !== 'RESOLVED' || !current.resolvedAt || current.resolvedAt < cutoff)
        throw new ConflictException({
          code: 'CONVERSATION_NOT_REOPENABLE',
          message: 'Conversation cannot be reopened',
        });
      if (current.assignedAgentMembershipId) {
        const previousProfile = await transaction.agentProfile.findUnique({
          where: { membershipId: current.assignedAgentMembershipId },
          select: { userId: true },
        });
        if (previousProfile)
          await transaction.conversationParticipant.updateMany({
            where: {
              conversationId: current.id,
              participantType: 'AGENT',
              participantId: previousProfile.userId,
              leftAt: null,
            },
            data: { leftAt: new Date() },
          });
      }
      const updated = await transaction.conversation.update({
        where: { id: current.id },
        data: {
          status: 'NEW',
          assignedAgentMembershipId: null,
          assignedAt: null,
          resolvedAt: null,
          reopenedAt: new Date(),
        },
      });
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId: identity.businessId,
        conversationId: current.id,
        type: 'REOPENED',
        actorType: 'VISITOR',
        actorId: identity.visitorId,
        metadata: { previousAgentMembershipId: current.assignedAgentMembershipId },
        systemMessage: 'Conversation reopened.',
      });
      return { updated, timeline, previous: current.assignedAgentMembershipId };
    });
    if (outcome.timeline.message) this.publishMessage(outcome.timeline.message, identity.visitorId);
    const response = await this.conversationResponse(outcome.updated);
    this.events.emit(CONVERSATION_OPERATION_EVENT, {
      businessId: identity.businessId,
      visitorId: identity.visitorId,
      conversation: response,
      event: this.timeline.serialize(outcome.timeline.event),
      operation: 'REOPENED',
      previousAssignedAgentMembershipId: outcome.previous,
      assignedAgentMembershipId: null,
    } satisfies ConversationOperationApplicationEvent);
    await this.routing.routeConversation(identity.businessId, conversation.id);
    return this.prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
  }

  private async queuePosition(entry: {
    businessId: string;
    departmentId: string | null;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    enqueuedAt: Date;
  }): Promise<number> {
    const weights = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 } as const;
    const higher = (Object.keys(weights) as (keyof typeof weights)[]).filter(
      (priority) => weights[priority] > weights[entry.priority],
    );
    return (
      1 +
      (await this.prisma.conversationQueueEntry.count({
        where: {
          businessId: entry.businessId,
          departmentId: entry.departmentId,
          assignedAt: null,
          removedAt: null,
          OR: [
            { priority: { in: higher } },
            { priority: entry.priority, enqueuedAt: { lt: entry.enqueuedAt } },
          ],
        },
      }))
    );
  }

  private publishMessage(
    message: Message & {
      receipts?: MessageReceipt[];
      attachments?: import('@prisma/client').Attachment[];
    },
    visitorId: string | null,
  ): void {
    const event: MessageCreatedApplicationEvent = {
      businessId: message.businessId,
      visitorId,
      message: serializeMessage(message),
    };
    this.events.emit(MESSAGE_CREATED_EVENT, event);
  }

  private publishReceipt(
    businessId: string,
    conversationId: string,
    messageId: string,
    state: 'DELIVERED' | 'READ',
    at: Date,
  ): MessageReceiptEvent {
    const receipt: MessageReceiptEvent = { conversationId, messageId, state, at: at.toISOString() };
    const event: MessageReceiptApplicationEvent = { businessId, conversationId, receipt };
    this.events.emit(MESSAGE_RECEIPT_EVENT, event);
    return receipt;
  }
}
