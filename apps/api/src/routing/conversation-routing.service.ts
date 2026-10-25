import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import type {
  AssignmentType,
  AgentProfile,
  Conversation,
  ConversationEvent,
  ConversationQueueEntry,
  Message,
  MessageReceipt,
  Prisma,
} from '@prisma/client';
import type {
  ConversationResponse,
  ConversationRoutingEvent,
  IntakeAnswer,
  OverflowStep,
} from '@bizchat/types';
import { BusinessHoursService } from '../business-hours/business-hours.service';
import type { Environment } from '../config/environment';
import {
  CONVERSATION_CREATED_EVENT,
  CONVERSATION_OPERATION_EVENT,
  MESSAGE_CREATED_EVENT,
  type ConversationCreatedApplicationEvent,
  type ConversationOperationApplicationEvent,
  type MessageCreatedApplicationEvent,
} from '../conversations/conversation-events';
import { serializeConversation, serializeMessage } from '../conversations/conversation-serializer';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { PresenceService } from '../realtime/presence.service';
import { RedisService } from '../realtime/redis.service';
import { RELEASE_IF_HOLDER_SCRIPT } from '../realtime/redis-lock';
import { nextOverflowAt, overflowScope, overflowSteps } from './overflow-policy';
import {
  CAPACITY_STATUSES,
  DrainScopeTracker,
  type EligibilityScope,
  orderCandidates,
  orderQueue,
  PRIORITY_WEIGHT,
  ROUTABLE_STATUSES,
} from './routing-policy';
import {
  CONVERSATION_CAPACITY_RELEASED_EVENT,
  CONVERSATION_OFFER_WITHDRAWN_EVENT,
  CONVERSATION_OFFERED_EVENT,
  CONVERSATION_ROUTED_EVENT,
  type ConversationCapacityReleasedApplicationEvent,
  type ConversationOfferedApplicationEvent,
  type ConversationOfferWithdrawnApplicationEvent,
  type ConversationRoutedApplicationEvent,
} from './routing-events';

type CandidateProfile = AgentProfile & { membership: { status: string }; user: { status: string } };
type RoutingOutcome = ConversationRoutingEvent['outcome'];

function outcomeOf(conversation: Conversation): RoutingOutcome {
  if (conversation.status === 'OFFERED') return 'OFFERED';
  return conversation.assignedAgentMembershipId ? 'ASSIGNED' : 'QUEUED';
}
interface SkillRequirement {
  skillId: string;
  minProficiency: number;
}

/** The departments and skill a conversation needs at its current overflow level. */
function eligibilityOf(
  conversation: Pick<
    Conversation,
    'departmentId' | 'overflowLevel' | 'requiredSkillId' | 'requiredSkillMinProficiency'
  >,
  steps: OverflowStep[],
): EligibilityScope {
  const overflow = overflowScope(conversation.departmentId, steps, conversation.overflowLevel);
  return {
    departmentIds: overflow.departmentIds,
    skillId: overflow.relaxSkill ? null : conversation.requiredSkillId,
    minProficiency: conversation.requiredSkillMinProficiency ?? 1,
  };
}

/** Durable eligibility; presence and capacity are checked separately. */
function eligibleProfileWhere(
  businessId: string,
  departmentIds: string[] | null,
  requirement: SkillRequirement | null,
  excludedProfileIds: string[] = [],
): Prisma.AgentProfileWhereInput {
  return {
    ...(excludedProfileIds.length ? { id: { notIn: excludedProfileIds } } : {}),
    businessId,
    status: 'ACTIVE',
    routingEnabled: true,
    membership: { status: 'ACTIVE' },
    user: { status: 'ACTIVE' },
    ...(departmentIds ? { departments: { some: { departmentId: { in: departmentIds } } } } : {}),
    ...(requirement
      ? {
          skills: {
            some: {
              skillId: requirement.skillId,
              proficiency: { gte: requirement.minProficiency },
            },
          },
        }
      : {}),
  };
}

const DRAIN_BATCH_SIZE = 200;
const DRAIN_LOCK_TTL_MS = 30_000;
const MAX_DRAIN_PASSES = 5;
const ABANDON_BATCH_SIZE = 200;

/**
 * Unassigned widget conversations whose visitor has neither sent a message nor held a live widget
 * session since the cutoff. The widget heartbeat refreshes `lastSeenAt` in PostgreSQL, so a Redis
 * outage cannot make a waiting visitor look departed.
 */
function departedVisitorWhere(cutoff: Date): Prisma.ConversationWhereInput {
  return {
    AND: [
      {
        OR: [
          { status: { in: [...ROUTABLE_STATUSES] }, assignedAgentMembershipId: null },
          { status: 'OFFERED' },
        ],
      },
      // A visitor who asked to be followed up intends to leave.
      { followUpRequestedAt: null },
      {
        OR: [{ lastMessageAt: { lt: cutoff } }, { lastMessageAt: null, createdAt: { lt: cutoff } }],
      },
    ],
    source: 'WEB_WIDGET',
    visitor: {
      is: { sessions: { none: { widgetSessions: { some: { lastSeenAt: { gte: cutoff } } } } } },
    },
  };
}

@Injectable()
export class ConversationRoutingService {
  private readonly logger = new Logger(ConversationRoutingService.name);
  private readonly abandonAfterSeconds: number;
  public constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly events: EventEmitter2,
    private readonly timeline: ConversationTimelineService,
    private readonly redis: RedisService,
    config: ConfigService<Environment, true>,
    private readonly hours: BusinessHoursService,
  ) {
    this.abandonAfterSeconds = config.get('QUEUE_ABANDON_AFTER_SECONDS', { infer: true });
  }

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
    return (await this.route(businessId, conversationId, options)).event;
  }

  /**
   * `constrained` is true when a queued outcome says nothing about other conversations in the same
   * scope: consultants were excluded for this conversation only, or nobody was looked for.
   */
  private async route(
    businessId: string,
    conversationId: string,
    options: { assignmentType?: AssignmentType; hoursChecked?: boolean },
  ): Promise<{ event: ConversationRoutingEvent; constrained: boolean }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, businessId },
    });
    if (!conversation) throw new Error('Conversation does not exist in tenant');
    // Intake is still waiting on the visitor; IntakeService routes once it completes.
    if (
      conversation.intakeStatus === 'AWAITING_TOPIC' ||
      conversation.intakeStatus === 'AWAITING_FORM'
    )
      return { event: await this.result(conversation, 'QUEUED'), constrained: true };
    if (
      conversation.assignedAgentMembershipId ||
      !ROUTABLE_STATUSES.includes(conversation.status as (typeof ROUTABLE_STATUSES)[number])
    ) {
      return { event: await this.result(conversation, outcomeOf(conversation)), constrained: true };
    }
    // Outside business hours nobody is offered or assigned a chat; it waits for opening time.
    if (!options.hoursChecked && !(await this.hours.isOpenNow(businessId)))
      return { event: await this.queue(conversation), constrained: true };

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
    const routing = await this.prisma.routingSettings.findUnique({
      where: { businessId },
      select: {
        routingStrategy: true,
        assignmentMode: true,
        offerTimeoutSeconds: true,
        exclusionSeconds: true,
      },
    });
    const scope = eligibilityOf(conversation, await this.topicSteps(conversation));
    const requirement = scope.skillId ? await this.skillRequirement(conversation) : null;
    const excluded = await this.recentlyRefusedBy(conversation, routing?.exclusionSeconds ?? 300);
    const candidates = await this.eligibleCandidates(
      conversation,
      scope.departmentIds,
      requirement,
      excluded,
    );
    for (const candidate of orderCandidates(
      candidates,
      previous?.assignedAgentMembershipId ?? previousAssignment?.agentProfile.membershipId ?? null,
      routing?.routingStrategy ?? 'LEAST_BUSY',
    )) {
      const offer =
        routing?.assignmentMode === 'OFFER'
          ? { expiresAt: new Date(Date.now() + routing.offerTimeoutSeconds * 1_000) }
          : null;
      const claimed = await this.tryClaim(
        conversation,
        candidate,
        options.assignmentType ?? 'AUTO',
        scope.departmentIds,
        requirement,
        offer,
      );
      if (!claimed) continue;
      if (claimed.timeline.message)
        this.publishTimelineMessage(claimed.timeline.message, claimed.conversation.visitorId);
      if (!claimed.offerId)
        return {
          event: await this.publish(claimed.conversation, 'ASSIGNED'),
          constrained: false,
        };
      const routed = await this.publish(claimed.conversation, 'OFFERED');
      this.events.emit(
        CONVERSATION_OFFERED_EVENT,
        await this.offerEvent(claimed.conversation, routed.conversation),
      );
      return { event: routed, constrained: false };
    }
    return { event: await this.queue(conversation), constrained: excluded.length > 0 };
  }

  /** The topic's overflow steps, read only once the conversation has overflowed. */
  private async topicSteps(
    conversation: Pick<Conversation, 'topicId' | 'overflowLevel'>,
  ): Promise<OverflowStep[]> {
    if (!conversation.topicId || conversation.overflowLevel === 0) return [];
    const topic = await this.prisma.topic.findUnique({
      where: { id: conversation.topicId },
      select: { overflowSteps: true },
    });
    return overflowSteps(topic?.overflowSteps);
  }

  /** The realtime payload for a pending offer, used when offering and when a consultant reconnects. */
  public async offerEvent(
    conversation: Conversation,
    response?: ConversationResponse,
  ): Promise<ConversationOfferedApplicationEvent> {
    if (
      conversation.status !== 'OFFERED' ||
      !conversation.currentOfferId ||
      !conversation.offerExpiresAt ||
      !conversation.assignedAgentMembershipId
    )
      throw new Error(`Conversation ${conversation.id} has no pending offer`);
    const [offer, first, intake] = await Promise.all([
      this.prisma.conversationOffer.findUniqueOrThrow({
        where: { id: conversation.currentOfferId },
        select: { offeredAt: true },
      }),
      this.prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          senderType: { in: ['VISITOR', 'CUSTOMER', 'INTEGRATION'] },
          deletedAt: null,
        },
        orderBy: { sequenceNumber: 'asc' },
        select: { content: true },
      }),
      // Pre-chat answers help the consultant decide; the intake module owns writing them.
      this.prisma.conversationIntake.findUnique({
        where: { conversationId: conversation.id },
        include: { form: { select: { name: true } } },
      }),
    ]);
    return {
      businessId: conversation.businessId,
      agentMembershipId: conversation.assignedAgentMembershipId,
      offerId: conversation.currentOfferId,
      conversation: response ?? (await this.conversationResponse(conversation, null, null)),
      firstMessage: first?.content ?? null,
      intake: intake
        ? {
            formName: intake.form?.name ?? null,
            formVersion: intake.formVersion,
            answers: intake.answers as unknown as IntakeAnswer[],
            consentAt: intake.consentAt?.toISOString() ?? null,
            submittedAt: intake.submittedAt.toISOString(),
          }
        : null,
      offeredAt: offer.offeredAt.toISOString(),
      expiresAt: conversation.offerExpiresAt.toISOString(),
    };
  }

  /**
   * Creates the assignment record, consultant participant, and visitor-visible "assigned" message.
   * Shared by direct assignment and by accepting an offer.
   */
  public async recordAssignmentInTransaction(
    transaction: Prisma.TransactionClient,
    conversation: Pick<Conversation, 'id' | 'businessId' | 'departmentId'>,
    agent: { id: string; membershipId: string; userId: string; displayName: string },
    assignmentType: AssignmentType,
    assignedAt: Date,
  ): Promise<{
    event: ConversationEvent;
    message: (Message & { receipts: MessageReceipt[] }) | null;
  }> {
    await transaction.conversationAssignment.create({
      data: {
        businessId: conversation.businessId,
        conversationId: conversation.id,
        agentProfileId: agent.id,
        departmentId: conversation.departmentId,
        assignmentType,
        assignedAt,
      },
    });
    await transaction.conversationParticipant.upsert({
      where: {
        conversationId_participantType_participantId: {
          conversationId: conversation.id,
          participantType: 'AGENT',
          participantId: agent.userId,
        },
      },
      update: { leftAt: null },
      create: {
        businessId: conversation.businessId,
        conversationId: conversation.id,
        participantType: 'AGENT',
        participantId: agent.userId,
      },
    });
    return this.timeline.recordInTransaction(transaction, {
      businessId: conversation.businessId,
      conversationId: conversation.id,
      type: 'ASSIGNED',
      actorType: 'SYSTEM',
      metadata: {
        agentProfileId: agent.id,
        agentMembershipId: agent.membershipId,
        agentName: agent.displayName,
      },
      systemMessage: `Conversation assigned to ${agent.displayName}.`,
    });
  }

  /**
   * Drains one tenant's queue, coalescing concurrent triggers across API instances: a trigger that
   * finds a drain in progress marks the queue dirty and the running drain makes another pass. A
   * trigger racing the final release can be missed; the reliability sweep drains every backlog within
   * one interval.
   */
  public async drainBusinessQueue(businessId: string): Promise<number> {
    const lockKey = `routing:drain:${businessId}:lock`;
    const pendingKey = `routing:drain:${businessId}:pending`;
    let assigned = 0;
    for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
      const token = randomUUID();
      try {
        const locked = await this.redis.set(lockKey, token, 'PX', DRAIN_LOCK_TTL_MS, 'NX');
        if (locked !== 'OK') {
          await this.redis.set(pendingKey, '1', 'PX', DRAIN_LOCK_TTL_MS);
          return assigned;
        }
        await this.redis.del(pendingKey);
      } catch (error) {
        // Redis only coalesces drains; conditional PostgreSQL claims keep an uncoordinated drain safe.
        this.logger.warn(
          `Queue drain lock unavailable for ${businessId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return assigned + (await this.drainOnce(businessId));
      }
      try {
        assigned += await this.drainOnce(businessId);
      } finally {
        await this.redis.eval(RELEASE_IF_HOLDER_SCRIPT, 1, lockKey, token).catch(() => undefined);
      }
      if ((await this.redis.exists(pendingKey).catch(() => 0)) === 0) return assigned;
    }
    return assigned;
  }

  /** Closes queued conversations whose visitor left before a consultant became available. */
  public async abandonDepartedVisitors(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.abandonAfterSeconds * 1_000);
    const candidates = await this.prisma.conversation.findMany({
      where: departedVisitorWhere(cutoff),
      orderBy: { createdAt: 'asc' },
      take: ABANDON_BATCH_SIZE,
      select: { id: true, businessId: true },
    });
    const moved = new Map<string, Set<string | null>>();
    let abandoned = 0;
    for (const candidate of candidates) {
      const closed = await this.abandon(candidate.businessId, candidate.id, cutoff);
      if (!closed) continue;
      abandoned += 1;
      const departments = moved.get(closed.businessId) ?? new Set<string | null>();
      departments.add(closed.departmentId);
      moved.set(closed.businessId, departments);
    }
    for (const [businessId, departments] of moved)
      await this.publishQueuePositions(businessId, departments);
    return abandoned;
  }

  public async drainForAgent(businessId: string, agentProfileId: string): Promise<void> {
    if ((await this.presence.getAgentState(businessId, agentProfileId)) === 'ONLINE')
      await this.drainBusinessQueue(businessId);
  }

  private async drainOnce(businessId: string): Promise<number> {
    // Checked once per pass: nobody is offered or assigned a chat outside business hours.
    if (!(await this.hours.isOpenNow(businessId))) return 0;
    const entries = await this.prisma.conversationQueueEntry.findMany({
      where: {
        businessId,
        assignedAt: null,
        removedAt: null,
        conversation: {
          status: 'QUEUED',
          assignedAgentMembershipId: null,
          intakeStatus: { in: ['NOT_REQUIRED', 'COMPLETE'] },
        },
      },
      // The priority enum is declared LOW..URGENT, so PostgreSQL sorts it by urgency.
      orderBy: [{ priority: 'desc' }, { enqueuedAt: 'asc' }, { id: 'asc' }],
      take: DRAIN_BATCH_SIZE,
      include: {
        conversation: {
          select: {
            departmentId: true,
            overflowLevel: true,
            requiredSkillId: true,
            requiredSkillMinProficiency: true,
            topic: { select: { overflowSteps: true } },
          },
        },
      },
    });
    const scopes = new DrainScopeTracker();
    let assigned = 0;
    for (const entry of orderQueue(entries)) {
      const { topic, ...conversation } = entry.conversation;
      const scope = eligibilityOf(
        conversation,
        conversation.overflowLevel > 0 ? overflowSteps(topic?.overflowSteps) : [],
      );
      if (!scopes.shouldAttempt(scope)) continue;
      const { event, constrained } = await this.route(businessId, entry.conversationId, {
        hoursChecked: true,
      });
      if (event.outcome !== 'QUEUED') {
        assigned += 1;
        scopes.recordAssigned(entry.departmentId);
      } else if (event.conversation.status === 'QUEUED' && !constrained) {
        // A consultant excluded for this conversation may still suit the next one in the scope.
        scopes.recordExhausted(scope);
      }
    }
    await this.publishQueuePositions(businessId, scopes.changedDepartments());
    return assigned;
  }

  /** Republishes queue positions to every conversation still waiting in the given departments. */
  private async publishQueuePositions(
    businessId: string,
    departmentIds: Set<string | null>,
  ): Promise<void> {
    if (departmentIds.size === 0) return;
    const named = [...departmentIds].filter((id): id is string => id !== null);
    const waiting = await this.prisma.conversation.findMany({
      where: {
        businessId,
        status: 'QUEUED',
        assignedAgentMembershipId: null,
        OR: [
          ...(named.length > 0 ? [{ departmentId: { in: named } }] : []),
          ...(departmentIds.has(null) ? [{ departmentId: null }] : []),
        ],
      },
      take: DRAIN_BATCH_SIZE,
    });
    for (const conversation of waiting) await this.publish(conversation, 'QUEUED');
  }

  private async abandon(
    businessId: string,
    conversationId: string,
    cutoff: Date,
  ): Promise<Conversation | null> {
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const closedAt = new Date();
      const before = await transaction.conversation.findFirst({
        where: { id: conversationId, businessId },
        select: { currentOfferId: true, assignedAgentMembershipId: true },
      });
      if (!before) return null;
      // Re-applying the departure filter makes a visitor who returned since the scan keep their place;
      // matching the offer ID means an offer accepted or replaced since the read is left alone.
      const closed = await transaction.conversation.updateMany({
        where: {
          id: conversationId,
          businessId,
          currentOfferId: before.currentOfferId,
          ...departedVisitorWhere(cutoff),
        },
        data: {
          status: 'CLOSED',
          closedAt,
          reassignmentDueAt: null,
          assignedAgentMembershipId: null,
          currentOfferId: null,
          offerExpiresAt: null,
        },
      });
      if (closed.count !== 1) return null;
      if (before.currentOfferId)
        await transaction.conversationOffer.update({
          where: { id: before.currentOfferId },
          data: { outcome: 'CANCELLED', respondedAt: closedAt, reason: 'VISITOR_LEFT' },
        });
      await transaction.conversationQueueEntry.updateMany({
        where: { conversationId, assignedAt: null, removedAt: null },
        data: { removedAt: closedAt },
      });
      await transaction.conversationParticipant.updateMany({
        where: { conversationId, participantType: 'VISITOR', leftAt: null },
        data: { leftAt: closedAt },
      });
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId,
        conversationId,
        type: 'CLOSED',
        actorType: 'SYSTEM',
        metadata: { reason: 'VISITOR_LEFT_QUEUE', abandonAfterSeconds: this.abandonAfterSeconds },
      });
      return {
        conversation: await transaction.conversation.findUniqueOrThrow({
          where: { id: conversationId },
        }),
        event: timeline.event,
        withdrawnOffer:
          before.currentOfferId && before.assignedAgentMembershipId
            ? {
                offerId: before.currentOfferId,
                agentMembershipId: before.assignedAgentMembershipId,
              }
            : null,
      };
    });
    if (!outcome) return null;
    if (outcome.withdrawnOffer)
      this.events.emit(CONVERSATION_OFFER_WITHDRAWN_EVENT, {
        businessId,
        agentMembershipId: outcome.withdrawnOffer.agentMembershipId,
        offerId: outcome.withdrawnOffer.offerId,
        conversationId,
        reason: 'CANCELLED',
      } satisfies ConversationOfferWithdrawnApplicationEvent);
    this.events.emit(CONVERSATION_OPERATION_EVENT, {
      businessId,
      visitorId: outcome.conversation.visitorId,
      conversation: await this.conversationResponse(outcome.conversation, null, null),
      event: this.timeline.serialize(outcome.event),
      operation: 'ABANDONED',
      previousAssignedAgentMembershipId: null,
      assignedAgentMembershipId: null,
    } satisfies ConversationOperationApplicationEvent);
    return outcome.conversation;
  }

  /**
   * The skill a conversation needs, or null. A requirement on a disabled skill is ignored so that
   * disabling a skill can never strand queued conversations.
   */
  private async skillRequirement(conversation: Conversation): Promise<SkillRequirement | null> {
    if (!conversation.requiredSkillId) return null;
    const skill = await this.prisma.skill.findFirst({
      where: {
        id: conversation.requiredSkillId,
        businessId: conversation.businessId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return skill
      ? { skillId: skill.id, minProficiency: conversation.requiredSkillMinProficiency ?? 1 }
      : null;
  }

  private async eligibleCandidates(
    conversation: Conversation,
    departmentIds: string[] | null,
    requirement: SkillRequirement | null,
    excludedProfileIds: string[],
  ): Promise<(CandidateProfile & { activeChats: number; proficiency?: number })[]> {
    const profiles = await this.prisma.agentProfile.findMany({
      where: eligibleProfileWhere(
        conversation.businessId,
        departmentIds,
        requirement,
        excludedProfileIds,
      ),
      include: {
        membership: { select: { status: true } },
        user: { select: { status: true } },
        skills: {
          ...(requirement ? { where: { skillId: requirement.skillId } } : {}),
          select: { proficiency: true },
          take: requirement ? 1 : 0,
        },
      },
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
      .map(({ profile: { skills, ...profile }, activeChats }) => ({
        ...profile,
        activeChats,
        ...(requirement ? { proficiency: skills[0]?.proficiency ?? 0 } : {}),
      }));
  }

  /**
   * Atomically gives a conversation to one consultant: assigned directly, or (with `offer`) held as
   * an offer that reserves their capacity until they accept or it expires.
   */
  private async tryClaim(
    conversation: Conversation,
    candidate: CandidateProfile,
    assignmentType: AssignmentType,
    departmentIds: string[] | null,
    requirement: SkillRequirement | null,
    offer: { expiresAt: Date } | null = null,
  ): Promise<{
    conversation: Conversation;
    timeline: {
      event: ConversationEvent;
      message: (Message & { receipts: MessageReceipt[] }) | null;
    };
    offerId: string | null;
  } | null> {
    return this.prisma.$transaction(async (transaction) => {
      const lockKey = `routing-capacity:${conversation.businessId}:${candidate.id}`;
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)) IS NULL AS acquired`;
      const currentCandidate = await transaction.agentProfile.findFirst({
        where: {
          ...eligibleProfileWhere(conversation.businessId, departmentIds, requirement),
          id: candidate.id,
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
      const offerId = offer ? randomUUID() : null;
      const claimed = await transaction.conversation.updateMany({
        where: {
          id: conversation.id,
          businessId: conversation.businessId,
          assignedAgentMembershipId: null,
          status: { in: [...ROUTABLE_STATUSES] },
        },
        data: offer
          ? {
              assignedAgentMembershipId: currentCandidate.membershipId,
              status: 'OFFERED',
              currentOfferId: offerId,
              offerExpiresAt: offer.expiresAt,
            }
          : {
              assignedAgentMembershipId: currentCandidate.membershipId,
              status: 'ASSIGNED',
              assignedAt: now,
            },
      });
      if (claimed.count !== 1) return null;
      // An offer counts as a turn for fairness, so a consultant who declines is not offered next.
      await transaction.agentProfile.update({
        where: { id: currentCandidate.id },
        data: { lastAssignedAt: now },
      });
      await transaction.conversationQueueEntry.updateMany({
        where: { conversationId: conversation.id, assignedAt: null },
        data: { assignedAt: now },
      });
      const agent = {
        id: currentCandidate.id,
        membershipId: currentCandidate.membershipId,
        userId: currentCandidate.userId,
        displayName: currentCandidate.user.displayName,
      };
      let timeline;
      if (offer && offerId) {
        await transaction.conversationOffer.create({
          data: {
            id: offerId,
            businessId: conversation.businessId,
            conversationId: conversation.id,
            agentProfileId: agent.id,
            offeredAt: now,
            expiresAt: offer.expiresAt,
            assignmentType,
          },
        });
        timeline = await this.timeline.recordInTransaction(transaction, {
          businessId: conversation.businessId,
          conversationId: conversation.id,
          type: 'OFFERED',
          actorType: 'SYSTEM',
          metadata: {
            offerId,
            agentProfileId: agent.id,
            agentMembershipId: agent.membershipId,
            agentName: agent.displayName,
            expiresAt: offer.expiresAt.toISOString(),
          },
        });
      } else {
        timeline = await this.recordAssignmentInTransaction(
          transaction,
          conversation,
          agent,
          assignmentType,
          now,
        );
      }
      return {
        conversation: await transaction.conversation.findUniqueOrThrow({
          where: { id: conversation.id },
        }),
        timeline,
        offerId,
      };
    });
  }

  /**
   * Consultants who declined or missed this conversation recently are skipped, within the current
   * routing cycle: an overflow step starts a new cycle, so everyone is eligible again.
   */
  private async recentlyRefusedBy(
    conversation: Pick<Conversation, 'id' | 'routingCycleStartedAt'>,
    exclusionSeconds: number,
  ): Promise<string[]> {
    const windowStart = new Date(Date.now() - exclusionSeconds * 1_000);
    const cycleStart = conversation.routingCycleStartedAt;
    const refused = await this.prisma.conversationOffer.findMany({
      where: {
        conversationId: conversation.id,
        outcome: { in: ['DECLINED', 'EXPIRED'] },
        respondedAt: { gte: cycleStart && cycleStart > windowStart ? cycleStart : windowStart },
      },
      select: { agentProfileId: true },
      distinct: ['agentProfileId'],
    });
    return refused.map(({ agentProfileId }) => agentProfileId);
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
      if (current.assignedAgentMembershipId || current.status !== 'QUEUED') return current;
      const entry = await transaction.conversationQueueEntry.upsert({
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
      await this.scheduleWaitTimers(transaction, current, entry.enqueuedAt);
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
    return this.publish(queued, outcomeOf(queued));
  }

  /**
   * Sets when the next overflow step and the maximum wait fall due, measured from when the
   * conversation joined the queue (a re-queued conversation keeps its original wait).
   */
  public async scheduleWaitTimers(
    transaction: Prisma.TransactionClient,
    conversation: Conversation,
    enqueuedAt: Date,
  ): Promise<void> {
    const topic = conversation.topicId
      ? await transaction.topic.findUnique({
          where: { id: conversation.topicId },
          select: { overflowSteps: true, maxWaitSeconds: true },
        })
      : null;
    const steps = overflowSteps(topic?.overflowSteps);
    // Only a widget visitor can be offered a follow-up while waiting.
    const maxWaitAt =
      topic?.maxWaitSeconds &&
      conversation.source === 'WEB_WIDGET' &&
      !conversation.maxWaitNotifiedAt &&
      !conversation.followUpRequestedAt
        ? new Date(enqueuedAt.getTime() + topic.maxWaitSeconds * 1_000)
        : null;
    await transaction.conversation.update({
      where: { id: conversation.id },
      data: {
        nextOverflowAt: nextOverflowAt(steps, conversation.overflowLevel, enqueuedAt),
        maxWaitAt,
      },
    });
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
    outcome: RoutingOutcome,
  ): Promise<ConversationRoutingEvent> {
    const queue =
      outcome === 'QUEUED'
        ? await this.prisma.conversationQueueEntry.findUnique({
            where: { conversationId: conversation.id },
          })
        : null;
    const position = queue ? await this.queuePosition(queue) : null;
    const response = await this.conversationResponse(
      conversation,
      queue?.enqueuedAt ?? null,
      position,
    );
    return {
      conversation: response,
      outcome,
      assignedAgentMembershipId: conversation.assignedAgentMembershipId,
      queuedAt: response.queuedAt,
      queuePosition: position,
    };
  }

  public async conversationResponse(
    conversation: Conversation,
    queuedAt: Date | null,
    queuePosition: number | null,
  ): Promise<ConversationResponse> {
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
    return {
      ...serializeConversation(conversation),
      departmentName: department?.name ?? null,
      queuedAt: queuedAt?.toISOString() ?? null,
      queuePosition,
      tags: conversationTags.map(({ tag }) => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        status: tag.status,
        createdAt: tag.createdAt.toISOString(),
        updatedAt: tag.updatedAt.toISOString(),
      })),
    };
  }

  public async publish(
    conversation: Conversation,
    outcome: RoutingOutcome,
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

  public publishTimelineMessage(
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
