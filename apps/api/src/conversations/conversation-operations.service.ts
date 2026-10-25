import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Conversation,
  ConversationEvent,
  Message,
  MessageReceipt,
  Prisma,
} from '@prisma/client';
import type {
  ConversationEventResponse,
  ConversationOperationEvent,
  ConversationResponse,
  MessageResponse,
} from '@bizchat/types';
import type {
  ConversationOperationInput,
  ConversationTransferInput,
  InternalNoteInput,
  SetConversationTagsInput,
} from '@bizchat/validation';
import type { AuthContext } from '../common/http.types';
import { roleHasPermission } from '../auth/rbac';
import { PrismaService } from '../database/prisma.service';
import { CAPACITY_STATUSES } from '../routing/routing-policy';
import { ConversationRoutingService } from '../routing/conversation-routing.service';
import {
  CONVERSATION_CAPACITY_RELEASED_EVENT,
  type ConversationCapacityReleasedApplicationEvent,
} from '../routing/routing-events';
import {
  CONVERSATION_OPERATION_EVENT,
  MESSAGE_CREATED_EVENT,
  type ConversationOperationApplicationEvent,
  type MessageCreatedApplicationEvent,
} from './conversation-events';
import { serializeConversation, serializeMessage } from './conversation-serializer';
import { ConversationStateService } from './conversation-state';
import { ConversationTimelineService } from './conversation-timeline.service';
import { MessageService } from './message.service';

type TimelineOutcome = {
  event: ConversationEvent;
  message: (Message & { receipts: MessageReceipt[] }) | null;
};

@Injectable()
export class ConversationOperationsService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageService,
    private readonly timeline: ConversationTimelineService,
    private readonly states: ConversationStateService,
    private readonly routing: ConversationRoutingService,
    private readonly events: EventEmitter2,
  ) {}

  public async transfer(
    auth: AuthContext,
    conversationId: string,
    input: ConversationTransferInput,
  ): Promise<ConversationResponse> {
    const initial = await this.findAccessible(auth, conversationId);
    if (!initial.assignedAgentMembershipId)
      throw new ConflictException({
        code: 'CONVERSATION_NOT_ASSIGNED',
        message: 'Only assigned conversations can be transferred',
      });
    if (initial.status === 'OFFERED')
      throw new ConflictException({
        code: 'CONVERSATION_OFFER_PENDING',
        message: 'Wait until the consultant accepts or the offer expires',
      });
    const expected = input.expectedAssignedAgentMembershipId ?? initial.assignedAgentMembershipId;
    if (input.agentProfileId)
      return this.transferToAgent(auth, initial, expected, input.agentProfileId, input.reason);
    return this.transferToDepartment(auth, initial, expected, input.departmentId!, input.reason);
  }

  public async resolve(
    auth: AuthContext,
    conversationId: string,
    input: ConversationOperationInput,
  ): Promise<ConversationResponse> {
    const initial = await this.findAccessible(auth, conversationId);
    this.states.assertTransition(initial.status, 'RESOLVED');
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await this.lockConversation(transaction, initial.businessId, initial.id);
      const current = await transaction.conversation.findUniqueOrThrow({
        where: { id: initial.id },
      });
      this.assertAccess(auth, current);
      this.states.assertTransition(current.status, 'RESOLVED');
      const now = new Date();
      const updated = await transaction.conversation.update({
        where: { id: current.id },
        data: { status: 'RESOLVED', resolvedAt: now },
      });
      await transaction.conversationAssignment.updateMany({
        where: { businessId: auth.business.id, conversationId, releasedAt: null },
        data: { releasedAt: now, reason: input.reason ?? 'Conversation resolved' },
      });
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId: auth.business.id,
        conversationId,
        type: 'RESOLVED',
        actorType: 'BUSINESS_USER',
        actorId: auth.user.id,
        metadata: { actorName: auth.user.displayName, reason: input.reason ?? null },
        systemMessage: 'Conversation marked resolved.',
      });
      return { conversation: updated, timeline };
    });
    const response = await this.response(outcome.conversation);
    this.publish(
      auth.business.id,
      outcome.conversation.visitorId,
      response,
      outcome.timeline,
      'RESOLVED',
      initial.assignedAgentMembershipId,
    );
    this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
      businessId: auth.business.id,
      agentMembershipId: initial.assignedAgentMembershipId,
      conversationId,
    } satisfies ConversationCapacityReleasedApplicationEvent);
    return response;
  }

  public async reopen(
    auth: AuthContext,
    conversationId: string,
    input: ConversationOperationInput,
  ): Promise<ConversationResponse> {
    const initial = await this.findAccessible(auth, conversationId);
    if (initial.status !== 'RESOLVED' || !initial.resolvedAt)
      throw new ConflictException({
        code: 'CONVERSATION_NOT_RESOLVED',
        message: 'Only resolved conversations can be reopened',
      });
    const settings = await this.prisma.widgetSettings.findUnique({
      where: { businessId: auth.business.id },
      select: { reopenWindowMinutes: true },
    });
    const cutoff = new Date(Date.now() - (settings?.reopenWindowMinutes ?? 1_440) * 60_000);
    if (initial.resolvedAt < cutoff)
      throw new ConflictException({
        code: 'REOPEN_WINDOW_EXPIRED',
        message: 'The configured reopen window has expired',
      });
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await this.lockConversation(transaction, initial.businessId, initial.id);
      const current = await transaction.conversation.findUniqueOrThrow({
        where: { id: initial.id },
      });
      this.assertAccess(auth, current);
      if (current.status !== 'RESOLVED' || !current.resolvedAt || current.resolvedAt < cutoff)
        throw new ConflictException({
          code: 'CONVERSATION_NOT_REOPENABLE',
          message: 'Conversation cannot be reopened',
        });
      await this.releaseAssignmentAndParticipant(
        transaction,
        current,
        new Date(),
        input.reason ?? 'Conversation reopened for routing',
      );
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
        businessId: auth.business.id,
        conversationId,
        type: 'REOPENED',
        actorType: 'BUSINESS_USER',
        actorId: auth.user.id,
        metadata: {
          actorName: auth.user.displayName,
          previousAgentMembershipId: current.assignedAgentMembershipId,
          reason: input.reason ?? null,
        },
        systemMessage: 'Conversation reopened.',
      });
      return { conversation: updated, timeline, previous: current.assignedAgentMembershipId };
    });
    const interim = await this.response(outcome.conversation);
    this.publish(
      auth.business.id,
      outcome.conversation.visitorId,
      interim,
      outcome.timeline,
      'REOPENED',
      outcome.previous,
    );
    return (await this.routing.routeConversation(auth.business.id, conversationId)).conversation;
  }

  public async addInternalNote(
    auth: AuthContext,
    conversationId: string,
    input: InternalNoteInput,
  ): Promise<MessageResponse> {
    const conversation = await this.findAccessible(auth, conversationId);
    if (['CLOSED'].includes(conversation.status))
      throw new ConflictException({
        code: 'CONVERSATION_CLOSED',
        message: 'Closed conversations cannot receive notes',
      });
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const created = await this.messages.createInTransaction(transaction, {
        businessId: auth.business.id,
        conversationId,
        senderType: 'AGENT',
        senderUserId: auth.user.id,
        clientMessageId: input.clientMessageId,
        content: input.content,
        messageType: 'INTERNAL_NOTE',
      });
      const timeline = created.created
        ? await this.timeline.recordInTransaction(transaction, {
            businessId: auth.business.id,
            conversationId,
            type: 'INTERNAL_NOTE_ADDED',
            actorType: 'BUSINESS_USER',
            actorId: auth.user.id,
            metadata: { actorName: auth.user.displayName, messageId: created.message.id },
          })
        : null;
      return { created, timeline };
    });
    if (outcome.created.created)
      this.publishMessage(outcome.created.message, conversation.visitorId);
    return serializeMessage(outcome.created.message);
  }

  public async eventsForConversation(
    auth: AuthContext,
    conversationId: string,
  ): Promise<ConversationEventResponse[]> {
    await this.findAccessible(auth, conversationId);
    const events = await this.prisma.conversationEvent.findMany({
      where: { businessId: auth.business.id, conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });
    return events.map((event) => this.timeline.serialize(event));
  }

  public async setTags(
    auth: AuthContext,
    conversationId: string,
    input: SetConversationTagsInput,
  ): Promise<ConversationResponse> {
    const conversation = await this.findAccessible(auth, conversationId);
    const uniqueIds = [...new Set(input.tagIds)];
    const valid = await this.prisma.tag.findMany({
      where: { businessId: auth.business.id, id: { in: uniqueIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (valid.length !== uniqueIds.length)
      throw new NotFoundException({
        code: 'TAG_NOT_FOUND',
        message: 'One or more tags are unavailable',
      });
    const timeline = await this.prisma.$transaction(async (transaction) => {
      await transaction.conversationTag.deleteMany({
        where: { businessId: auth.business.id, conversationId },
      });
      if (valid.length)
        await transaction.conversationTag.createMany({
          data: valid.map(({ id }) => ({
            businessId: auth.business.id,
            conversationId,
            tagId: id,
            addedByUserId: auth.user.id,
          })),
        });
      return this.timeline.recordInTransaction(transaction, {
        businessId: auth.business.id,
        conversationId,
        type: 'TAGS_CHANGED',
        actorType: 'BUSINESS_USER',
        actorId: auth.user.id,
        metadata: { actorName: auth.user.displayName, tagIds: uniqueIds },
      });
    });
    const response = await this.response(conversation);
    this.publish(
      auth.business.id,
      conversation.visitorId,
      response,
      timeline,
      'TAGS_CHANGED',
      conversation.assignedAgentMembershipId,
    );
    return response;
  }

  private async transferToAgent(
    auth: AuthContext,
    initial: Conversation,
    expected: string,
    targetProfileId: string,
    reason?: string,
  ): Promise<ConversationResponse> {
    const target = await this.prisma.agentProfile.findFirst({
      where: {
        id: targetProfileId,
        businessId: auth.business.id,
        status: 'ACTIVE',
        membership: { status: 'ACTIVE' },
        user: { status: 'ACTIVE' },
      },
      include: { user: true },
    });
    if (!target)
      throw new NotFoundException({
        code: 'TRANSFER_TARGET_NOT_FOUND',
        message: 'Receiving consultant is unavailable',
      });
    if (target.membershipId === expected)
      throw new ConflictException({
        code: 'TRANSFER_TARGET_UNCHANGED',
        message: 'Conversation is already assigned to this consultant',
      });
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`routing-capacity:${auth.business.id}:${target.id}`}, 0)) IS NULL AS acquired`;
      await this.lockConversation(transaction, auth.business.id, initial.id);
      const current = await transaction.conversation.findUniqueOrThrow({
        where: { id: initial.id },
      });
      this.assertAccess(auth, current);
      this.assertExpected(current, expected);
      const freshTarget = await transaction.agentProfile.findFirst({
        where: {
          id: target.id,
          businessId: auth.business.id,
          status: 'ACTIVE',
          membership: { status: 'ACTIVE' },
          user: { status: 'ACTIVE' },
          ...(current.departmentId
            ? { departments: { some: { departmentId: current.departmentId } } }
            : {}),
        },
        include: { user: true },
      });
      if (!freshTarget)
        throw new ConflictException({
          code: 'TRANSFER_TARGET_INELIGIBLE',
          message: 'Receiving consultant is not eligible for this department',
        });
      const capacity = await transaction.conversation.count({
        where: {
          businessId: auth.business.id,
          assignedAgentMembershipId: freshTarget.membershipId,
          status: { in: [...CAPACITY_STATUSES] },
        },
      });
      if (capacity >= freshTarget.maxConcurrentChats)
        throw new ConflictException({
          code: 'TRANSFER_TARGET_AT_CAPACITY',
          message: 'Receiving consultant is at capacity',
        });
      const now = new Date();
      await this.releaseAssignmentAndParticipant(
        transaction,
        current,
        now,
        reason ?? 'Transferred to another consultant',
      );
      const updated = await transaction.conversation.update({
        where: { id: current.id },
        data: {
          assignedAgentMembershipId: freshTarget.membershipId,
          status: 'ASSIGNED',
          assignedAt: now,
          resolvedAt: null,
        },
      });
      await transaction.agentProfile.update({
        where: { id: freshTarget.id },
        data: { lastAssignedAt: now },
      });
      await transaction.conversationAssignment.create({
        data: {
          businessId: auth.business.id,
          conversationId: current.id,
          agentProfileId: freshTarget.id,
          departmentId: current.departmentId,
          assignedByMembershipId: auth.membership.id,
          assignmentType: 'TRANSFER',
          assignedAt: now,
          reason,
        },
      });
      await transaction.conversationParticipant.upsert({
        where: {
          conversationId_participantType_participantId: {
            conversationId: current.id,
            participantType: 'AGENT',
            participantId: freshTarget.userId,
          },
        },
        update: { leftAt: null, joinedAt: now },
        create: {
          businessId: auth.business.id,
          conversationId: current.id,
          participantType: 'AGENT',
          participantId: freshTarget.userId,
          joinedAt: now,
        },
      });
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId: auth.business.id,
        conversationId: current.id,
        type: 'TRANSFERRED',
        actorType: 'BUSINESS_USER',
        actorId: auth.user.id,
        metadata: {
          actorName: auth.user.displayName,
          fromMembershipId: expected,
          toMembershipId: freshTarget.membershipId,
          toAgentName: freshTarget.user.displayName,
          reason: reason ?? null,
        },
        systemMessage: `${auth.user.displayName} transferred the conversation to ${freshTarget.user.displayName}.`,
      });
      return { conversation: updated, timeline, target: freshTarget };
    });
    const response = await this.response(outcome.conversation);
    this.publish(
      auth.business.id,
      initial.visitorId,
      response,
      outcome.timeline,
      'TRANSFERRED',
      expected,
    );
    this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
      businessId: auth.business.id,
      agentMembershipId: expected,
      conversationId: initial.id,
    } satisfies ConversationCapacityReleasedApplicationEvent);
    return response;
  }

  private async transferToDepartment(
    auth: AuthContext,
    initial: Conversation,
    expected: string,
    departmentId: string,
    reason?: string,
  ): Promise<ConversationResponse> {
    const outcome = await this.prisma.$transaction(async (transaction) => {
      await this.lockConversation(transaction, auth.business.id, initial.id);
      const current = await transaction.conversation.findUniqueOrThrow({
        where: { id: initial.id },
      });
      this.assertAccess(auth, current);
      this.assertExpected(current, expected);
      const department = await transaction.department.findFirst({
        where: { id: departmentId, businessId: auth.business.id, status: 'ACTIVE' },
      });
      if (!department)
        throw new NotFoundException({
          code: 'TRANSFER_DEPARTMENT_NOT_FOUND',
          message: 'Receiving department is unavailable',
        });
      const now = new Date();
      await this.releaseAssignmentAndParticipant(
        transaction,
        current,
        now,
        reason ?? 'Transferred to another department',
      );
      const updated = await transaction.conversation.update({
        where: { id: current.id },
        data: {
          departmentId,
          assignedAgentMembershipId: null,
          status: 'QUEUED',
          assignedAt: null,
          resolvedAt: null,
        },
      });
      await transaction.conversationQueueEntry.upsert({
        where: { conversationId: current.id },
        update: {
          departmentId,
          assignedAt: null,
          removedAt: null,
          enqueuedAt: now,
          attempts: 0,
          lastAttemptAt: null,
        },
        create: {
          businessId: auth.business.id,
          conversationId: current.id,
          departmentId,
          priority: current.priority,
          enqueuedAt: now,
        },
      });
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId: auth.business.id,
        conversationId: current.id,
        type: 'TRANSFERRED',
        actorType: 'BUSINESS_USER',
        actorId: auth.user.id,
        metadata: {
          actorName: auth.user.displayName,
          fromMembershipId: expected,
          toDepartmentId: department.id,
          toDepartmentName: department.name,
          reason: reason ?? null,
        },
        systemMessage: `${auth.user.displayName} transferred the conversation to ${department.name}.`,
      });
      return { conversation: updated, timeline };
    });
    const queuedResponse = await this.response(outcome.conversation);
    this.publish(
      auth.business.id,
      initial.visitorId,
      queuedResponse,
      outcome.timeline,
      'TRANSFERRED',
      expected,
    );
    this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
      businessId: auth.business.id,
      agentMembershipId: expected,
      conversationId: initial.id,
    } satisfies ConversationCapacityReleasedApplicationEvent);
    return (await this.routing.routeConversation(auth.business.id, initial.id)).conversation;
  }

  private async releaseAssignmentAndParticipant(
    transaction: Prisma.TransactionClient,
    conversation: Conversation,
    at: Date,
    reason: string,
  ): Promise<void> {
    await transaction.conversationAssignment.updateMany({
      where: {
        businessId: conversation.businessId,
        conversationId: conversation.id,
        releasedAt: null,
      },
      data: { releasedAt: at, reason },
    });
    if (!conversation.assignedAgentMembershipId) return;
    const profile = await transaction.agentProfile.findUnique({
      where: { membershipId: conversation.assignedAgentMembershipId },
      select: { userId: true },
    });
    if (profile)
      await transaction.conversationParticipant.updateMany({
        where: {
          conversationId: conversation.id,
          participantType: 'AGENT',
          participantId: profile.userId,
          leftAt: null,
        },
        data: { leftAt: at },
      });
  }

  private async lockConversation(
    transaction: Prisma.TransactionClient,
    businessId: string,
    conversationId: string,
  ): Promise<void> {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation-operation:${businessId}:${conversationId}`}, 0)) IS NULL AS acquired`;
  }

  private assertExpected(conversation: Conversation, expected: string): void {
    if (conversation.assignedAgentMembershipId !== expected)
      throw new ConflictException({
        code: 'CONVERSATION_ASSIGNMENT_CHANGED',
        message: 'Conversation assignment changed before this operation completed',
      });
  }

  private assertAccess(auth: AuthContext, conversation: Conversation): void {
    if (
      conversation.businessId !== auth.business.id ||
      (!roleHasPermission(auth.membership.role, 'conversation:view_all') &&
        conversation.assignedAgentMembershipId !== auth.membership.id)
    ) {
      throw new ForbiddenException({
        code: 'CONVERSATION_ACCESS_DENIED',
        message: 'Conversation is unavailable',
      });
    }
  }

  private async findAccessible(auth: AuthContext, id: string): Promise<Conversation> {
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

  private async response(conversation: Conversation): Promise<ConversationResponse> {
    const current = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    const [department, topic, tags, queue] = await Promise.all([
      current.departmentId
        ? this.prisma.department.findUnique({
            where: { id: current.departmentId },
            select: { name: true },
          })
        : null,
      current.topicId
        ? this.prisma.topic.findUnique({ where: { id: current.topicId }, select: { name: true } })
        : null,
      this.prisma.conversationTag.findMany({
        where: { businessId: current.businessId, conversationId: current.id },
        include: { tag: true },
        orderBy: { createdAt: 'asc' },
      }),
      current.status === 'QUEUED'
        ? this.prisma.conversationQueueEntry.findUnique({ where: { conversationId: current.id } })
        : null,
    ]);
    return {
      ...serializeConversation(current),
      departmentName: department?.name ?? null,
      topicName: topic?.name ?? null,
      queuedAt: queue?.enqueuedAt.toISOString() ?? null,
      queuePosition: null,
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

  private publish(
    businessId: string,
    visitorId: string | null,
    conversation: ConversationResponse,
    timeline: TimelineOutcome,
    operation: ConversationOperationEvent['operation'],
    previous: string | null,
  ): void {
    const event: ConversationOperationApplicationEvent = {
      businessId,
      visitorId,
      conversation,
      event: this.timeline.serialize(timeline.event),
      operation,
      previousAssignedAgentMembershipId: previous,
      assignedAgentMembershipId: conversation.assignedAgentMembershipId,
    };
    this.events.emit(CONVERSATION_OPERATION_EVENT, event);
    if (timeline.message) this.publishMessage(timeline.message, visitorId);
  }

  private publishMessage(
    message: Message & { receipts?: MessageReceipt[] },
    visitorId: string | null,
  ): void {
    this.events.emit(MESSAGE_CREATED_EVENT, {
      businessId: message.businessId,
      visitorId,
      message: serializeMessage(message),
    } satisfies MessageCreatedApplicationEvent);
  }
}
