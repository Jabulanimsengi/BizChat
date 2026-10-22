import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type {
  AssignmentType,
  AgentProfile,
  Conversation,
  ConversationEvent,
  ConversationQueueEntry,
  Message,
  MessageReceipt,
} from '@prisma/client';
import type { ConversationResponse, ConversationRoutingEvent } from '@bizchat/types';
import {
  CONVERSATION_CREATED_EVENT,
  MESSAGE_CREATED_EVENT,
  type ConversationCreatedApplicationEvent,
  type MessageCreatedApplicationEvent,
} from '../conversations/conversation-events';
import { serializeConversation, serializeMessage } from '../conversations/conversation-serializer';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { PresenceService } from '../realtime/presence.service';
import {
  CAPACITY_STATUSES,
  orderCandidates,
  orderQueue,
  PRIORITY_WEIGHT,
  ROUTABLE_STATUSES,
} from './routing-policy';
import {
  CONVERSATION_CAPACITY_RELEASED_EVENT,
  CONVERSATION_ROUTED_EVENT,
  type ConversationCapacityReleasedApplicationEvent,
  type ConversationRoutedApplicationEvent,
} from './routing-events';

type CandidateProfile = AgentProfile & { membership: { status: string }; user: { status: string } };

@Injectable()
export class ConversationRoutingService {
  private readonly logger = new Logger(ConversationRoutingService.name);
  public constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly events: EventEmitter2,
    private readonly timeline: ConversationTimelineService,
  ) {}

  @OnEvent(CONVERSATION_CREATED_EVENT, { async: true })
  public async newConversation(event: ConversationCreatedApplicationEvent): Promise<void> {
    await this.routeConversation(event.businessId, event.conversation.id).catch((error: unknown) =>
      this.logger.error(
        `Routing failed for ${event.conversation.id}`,
        error instanceof Error ? error.stack : String(error),
      ),
    );
  }

  @OnEvent(CONVERSATION_CAPACITY_RELEASED_EVENT, { async: true })
  public async capacityReleased(
    event: ConversationCapacityReleasedApplicationEvent,
  ): Promise<void> {
    await this.drainBusinessQueue(event.businessId).catch((error: unknown) =>
      this.logger.error(
        `Queue drain failed for ${event.businessId}`,
        error instanceof Error ? error.stack : String(error),
      ),
    );
  }

  public async routeConversation(
    businessId: string,
    conversationId: string,
    options: { assignmentType?: AssignmentType } = {},
  ): Promise<ConversationRoutingEvent> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, businessId },
    });
    if (!conversation) throw new Error('Conversation does not exist in tenant');
    if (
      conversation.assignedAgentMembershipId ||
      !ROUTABLE_STATUSES.includes(conversation.status as (typeof ROUTABLE_STATUSES)[number])
    ) {
      return this.result(
        conversation,
        conversation.assignedAgentMembershipId ? 'ASSIGNED' : 'QUEUED',
      );
    }

    const settings = await this.prisma.widgetSettings.findUnique({
      where: { businessId },
      select: { preferPreviousConsultant: true },
    });
    const previous =
      settings?.preferPreviousConsultant && conversation.visitorId
        ? await this.prisma.conversation.findFirst({
            where: {
              businessId,
              visitorId: conversation.visitorId,
              id: { not: conversation.id },
              assignedAgentMembershipId: { not: null },
              status: { in: ['RESOLVED', 'CLOSED'] },
              ...(conversation.departmentId ? { departmentId: conversation.departmentId } : {}),
            },
            orderBy: [{ resolvedAt: 'desc' }, { updatedAt: 'desc' }],
            select: { assignedAgentMembershipId: true },
          })
        : null;
    const previousAssignment = settings?.preferPreviousConsultant
      ? await this.prisma.conversationAssignment.findFirst({
          where: { businessId, conversationId: conversation.id },
          orderBy: { assignedAt: 'desc' },
          select: { agentProfile: { select: { membershipId: true } } },
        })
      : null;
    const candidates = await this.eligibleCandidates(conversation);
    for (const candidate of orderCandidates(
      candidates,
      previous?.assignedAgentMembershipId ?? previousAssignment?.agentProfile.membershipId ?? null,
    )) {
      const assigned = await this.tryClaim(
        conversation,
        candidate,
        options.assignmentType ?? 'AUTO',
      );
      if (assigned) {
        if (assigned.timeline.message)
          this.publishTimelineMessage(assigned.timeline.message, assigned.conversation.visitorId);
        return this.publish(assigned.conversation, 'ASSIGNED');
      }
    }
    return this.queue(conversation);
  }

  public async drainBusinessQueue(businessId: string): Promise<number> {
    const entries = await this.prisma.conversationQueueEntry.findMany({
      where: {
        businessId,
        assignedAt: null,
        removedAt: null,
        conversation: { status: 'QUEUED', assignedAgentMembershipId: null },
      },
      take: 200,
    });
    let assigned = 0;
    for (const entry of orderQueue(entries)) {
      const result = await this.routeConversation(businessId, entry.conversationId);
      if (result.outcome === 'ASSIGNED') assigned += 1;
    }
    return assigned;
  }

  public async drainForAgent(businessId: string, agentProfileId: string): Promise<void> {
    if ((await this.presence.getAgentState(businessId, agentProfileId)) === 'ONLINE')
      await this.drainBusinessQueue(businessId);
  }

  private async eligibleCandidates(
    conversation: Conversation,
  ): Promise<(CandidateProfile & { activeChats: number })[]> {
    const profiles = await this.prisma.agentProfile.findMany({
      where: {
        businessId: conversation.businessId,
        status: 'ACTIVE',
        routingEnabled: true,
        membership: { status: 'ACTIVE' },
        user: { status: 'ACTIVE' },
        ...(conversation.departmentId
          ? { departments: { some: { departmentId: conversation.departmentId } } }
          : {}),
      },
      include: { membership: { select: { status: true } }, user: { select: { status: true } } },
    });
    const evaluated = await Promise.all(
      profiles.map(async (profile) => ({
        profile,
        presence: await this.presence.getAgentState(conversation.businessId, profile.id),
        activeChats: await this.capacity(profile.businessId, profile.membershipId),
      })),
    );
    return evaluated
      .filter(
        ({ profile, presence, activeChats }) =>
          presence === 'ONLINE' && activeChats < profile.maxConcurrentChats,
      )
      .map(({ profile, activeChats }) => ({ ...profile, activeChats }));
  }

  private async tryClaim(
    conversation: Conversation,
    candidate: CandidateProfile,
    assignmentType: AssignmentType,
  ): Promise<{
    conversation: Conversation;
    timeline: {
      event: ConversationEvent;
      message: (Message & { receipts: MessageReceipt[] }) | null;
    };
  } | null> {
    return this.prisma.$transaction(async (transaction) => {
      const lockKey = `routing-capacity:${conversation.businessId}:${candidate.id}`;
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS acquired`;
      const currentCandidate = await transaction.agentProfile.findFirst({
        where: {
          id: candidate.id,
          businessId: conversation.businessId,
          status: 'ACTIVE',
          routingEnabled: true,
          membership: { status: 'ACTIVE' },
          user: { status: 'ACTIVE' },
          ...(conversation.departmentId
            ? { departments: { some: { departmentId: conversation.departmentId } } }
            : {}),
        },
        include: { user: { select: { displayName: true } } },
      });
      if (
        !currentCandidate ||
        (await this.capacity(
          conversation.businessId,
          currentCandidate.membershipId,
          transaction,
        )) >= currentCandidate.maxConcurrentChats
      )
        return null;
      const now = new Date();
      const claimed = await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          businessId: conversation.businessId,
          assignedAgentMembershipId: null,
          status: { in: [...ROUTABLE_STATUSES] },
        },
        data: {
          assignedAgentMembershipId: currentCandidate.membershipId,
          status: 'ASSIGNED',
          assignedAt: now,
        },
      });
      if (claimed.count !== 1) return null;
      await transaction.agentProfile.update({
        where: { id: currentCandidate.id },
        data: { lastAssignedAt: now },
      });
      await transaction.conversationAssignment.create({
        data: {
          businessId: conversation.businessId,
          conversationId: conversation.id,
          agentProfileId: currentCandidate.id,
          departmentId: conversation.departmentId,
          assignmentType,
          assignedAt: now,
        },
      });
      await transaction.conversationParticipant.upsert({
        where: {
          conversationId_participantType_participantId: {
            conversationId: conversation.id,
            participantType: 'AGENT',
            participantId: currentCandidate.userId,
          },
        },
        update: { leftAt: null },
        create: {
          businessId: conversation.businessId,
          conversationId: conversation.id,
          participantType: 'AGENT',
          participantId: currentCandidate.userId,
        },
      });
      await transaction.conversationQueueEntry.updateMany({
        where: { conversationId: conversation.id, assignedAt: null },
        data: { assignedAt: now },
      });
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId: conversation.businessId,
        conversationId: conversation.id,
        type: 'ASSIGNED',
        actorType: 'SYSTEM',
        metadata: {
          agentProfileId: currentCandidate.id,
          agentMembershipId: currentCandidate.membershipId,
          agentName: currentCandidate.user.displayName,
        },
        systemMessage: `Conversation assigned to ${currentCandidate.user.displayName}.`,
      });
      return {
        conversation: await transaction.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        }),
        timeline,
      };
    });
  }

  private async queue(conversation: Conversation): Promise<ConversationRoutingEvent> {
    const queued = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          businessId: conversation.businessId,
          assignedAgentMembershipId: null,
          status: 'NEW',
        },
        data: { status: 'QUEUED' },
      });
      const current = await transaction.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      if (current.assignedAgentMembershipId) return current;
      await transaction.conversationQueueEntry.upsert({
        where: { conversationId: conversation.id },
        update: {
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          assignedAt: null,
          removedAt: null,
        },
        create: {
          businessId: conversation.businessId,
          conversationId: conversation.id,
          departmentId: conversation.departmentId,
          priority: conversation.priority,
          attempts: 1,
          lastAttemptAt: new Date(),
        },
      });
      if (changed.count === 1)
        await this.timeline.recordInTransaction(transaction, {
          businessId: conversation.businessId,
          conversationId: conversation.id,
          type: 'QUEUED',
          actorType: 'SYSTEM',
          metadata: { departmentId: conversation.departmentId, priority: conversation.priority },
        });
      return current;
    });
    return this.publish(queued, queued.assignedAgentMembershipId ? 'ASSIGNED' : 'QUEUED');
  }

  private async capacity(
    businessId: string,
    membershipId: string,
    transaction: Pick<PrismaService, 'conversation'> = this.prisma,
  ): Promise<number> {
    return transaction.conversation.count({
      where: {
        businessId,
        assignedAgentMembershipId: membershipId,
        status: { in: [...CAPACITY_STATUSES] },
      },
    });
  }

  private async result(
    conversation: Conversation,
    outcome: 'ASSIGNED' | 'QUEUED',
  ): Promise<ConversationRoutingEvent> {
    const queue = await this.prisma.conversationQueueEntry.findUnique({
      where: { conversationId: conversation.id },
    });
    const department = conversation.departmentId
      ? await this.prisma.department.findUnique({
          where: { id: conversation.departmentId },
          select: { name: true },
        })
      : null;
    const conversationTags = await this.prisma.conversationTag.findMany({
      where: { conversationId: conversation.id },
      include: { tag: true },
      orderBy: { createdAt: 'asc' },
    });
    const position = outcome === 'QUEUED' && queue ? await this.queuePosition(queue) : null;
    const response: ConversationResponse = {
      ...serializeConversation(conversation),
      departmentName: department?.name ?? null,
      queuedAt: outcome === 'QUEUED' ? (queue?.enqueuedAt.toISOString() ?? null) : null,
      queuePosition: position,
      tags: conversationTags.map(({ tag }) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        status: tag.status,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      })),
    };
    return {
      conversation: response,
      outcome,
      assignedAgentMembershipId: conversation.assignedAgentMembershipId,
      queuedAt: response.queuedAt,
      queuePosition: position,
    };
  }

  private async publish(
    conversation: Conversation,
    outcome: 'ASSIGNED' | 'QUEUED',
  ): Promise<ConversationRoutingEvent> {
    const result = await this.result(conversation, outcome);
    this.events.emit(CONVERSATION_ROUTED_EVENT, {
      ...result,
      businessId: conversation.businessId,
      visitorId: conversation.visitorId,
    } satisfies ConversationRoutedApplicationEvent);
    return result;
  }

  private async queuePosition(entry: ConversationQueueEntry): Promise<number> {
    const higher = Object.entries(PRIORITY_WEIGHT)
      .filter(([, weight]) => weight > PRIORITY_WEIGHT[entry.priority])
      .map(([priority]) => priority as ConversationQueueEntry['priority']);
    const ahead = await this.prisma.conversationQueueEntry.count({
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
    });
    return ahead + 1;
  }

  private publishTimelineMessage(
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
