import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Conversation, ConversationEvent } from '@prisma/client';
import type { ConversationResponse, FollowUpContact } from '@bizchat/types';
import type { FollowUpRequestInput } from '@bizchat/validation';
import {
  CONVERSATION_OPERATION_EVENT,
  type ConversationOperationApplicationEvent,
} from '../conversations/conversation-events';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { ConversationRoutingService } from './conversation-routing.service';
import { dueOverflowLevel, nextOverflowAt, overflowSteps } from './overflow-policy';
import {
  CONVERSATION_WAIT_OPTIONS_EVENT,
  type ConversationWaitOptionsApplicationEvent,
} from './routing-events';

const WAIT_BATCH_SIZE = 200;

/** Unassigned and still waiting for a consultant. */
const WAITING = { status: 'QUEUED' as const, assignedAgentMembershipId: null };

/**
 * What happens while a conversation waits: overflow steps widen who may take it, the maximum wait
 * offers the visitor a follow-up, and a follow-up request records their contact details.
 */
@Injectable()
export class QueueWaitService {
  private readonly logger = new Logger(QueueWaitService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly routing: ConversationRoutingService,
    private readonly timeline: ConversationTimelineService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Reliability-sweep step: moves due conversations to the overflow level their wait has reached
   * (skipping levels the sweep missed), starts a new routing cycle, and drains the affected tenants.
   */
  public async advanceOverflow(now = new Date()): Promise<number> {
    const due = await this.prisma.conversation.findMany({
      where: { ...WAITING, nextOverflowAt: { lte: now } },
      orderBy: { nextOverflowAt: 'asc' },
      take: WAIT_BATCH_SIZE,
      select: {
        id: true,
        businessId: true,
        overflowLevel: true,
        topic: { select: { overflowSteps: true } },
        queueEntry: { select: { enqueuedAt: true } },
      },
    });
    const tenants = new Set<string>();
    let advanced = 0;
    for (const candidate of due) {
      try {
        if (!(await this.advance(candidate, now))) continue;
        advanced += 1;
        tenants.add(candidate.businessId);
      } catch (error) {
        this.logger.warn(`Overflow failed for ${candidate.id}: ${this.message(error)}`);
      }
    }
    for (const businessId of tenants)
      await this.routing.drainBusinessQueue(businessId).catch((error: unknown) => {
        this.logger.warn(
          `Queue drain after overflow failed for ${businessId}: ${this.message(error)}`,
        );
      });
    return advanced;
  }

  /** Reliability-sweep step: tells visitors who passed the topic's maximum wait about follow-ups. */
  public async notifyLongWaits(now = new Date()): Promise<number> {
    const due = await this.prisma.conversation.findMany({
      where: {
        ...WAITING,
        maxWaitAt: { lte: now },
        maxWaitNotifiedAt: null,
        followUpRequestedAt: null,
      },
      orderBy: { maxWaitAt: 'asc' },
      take: WAIT_BATCH_SIZE,
      select: { id: true, businessId: true, maxWaitAt: true },
    });
    let notified = 0;
    for (const candidate of due) {
      const outcome = await this.prisma.$transaction(async (transaction) => {
        const changed = await transaction.conversation.updateMany({
          where: {
            id: candidate.id,
            ...WAITING,
            maxWaitAt: candidate.maxWaitAt,
            maxWaitNotifiedAt: null,
            followUpRequestedAt: null,
          },
          data: { maxWaitNotifiedAt: now, maxWaitAt: null },
        });
        if (changed.count !== 1) return null;
        return this.timeline.recordInTransaction(transaction, {
          businessId: candidate.businessId,
          conversationId: candidate.id,
          type: 'MAX_WAIT_REACHED',
          actorType: 'SYSTEM',
          metadata: { maxWaitAt: candidate.maxWaitAt?.toISOString() ?? null },
        });
      });
      if (!outcome) continue;
      notified += 1;
      this.events.emit(CONVERSATION_WAIT_OPTIONS_EVENT, {
        businessId: candidate.businessId,
        conversationId: candidate.id,
        reason: 'MAX_WAIT',
      } satisfies ConversationWaitOptionsApplicationEvent);
    }
    return notified;
  }

  /**
   * Records the visitor's contact details. The conversation stays queued, so a consultant can still
   * pick it up, and is no longer closed when the visitor leaves.
   */
  public async requestFollowUp(
    identity: { businessId: string; visitorId: string },
    input: FollowUpRequestInput,
  ): Promise<ConversationResponse> {
    const contact: FollowUpContact = {
      name: input.name || null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      note: input.note || null,
    };
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const changed = await transaction.conversation.updateMany({
        where: {
          id: input.conversationId,
          businessId: identity.businessId,
          visitorId: identity.visitorId,
          status: { in: ['NEW', 'QUEUED'] },
          assignedAgentMembershipId: null,
          intakeStatus: { in: ['NOT_REQUIRED', 'COMPLETE'] },
          followUpRequestedAt: null,
        },
        data: { followUpRequestedAt: now, followUpContact: { ...contact }, maxWaitAt: null },
      });
      if (changed.count !== 1) return null;
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId: identity.businessId,
        conversationId: input.conversationId,
        type: 'FOLLOW_UP_REQUESTED',
        actorType: 'VISITOR',
        actorId: identity.visitorId,
        // Which channels were left, not the details themselves: timeline metadata is widely read.
        metadata: { email: Boolean(contact.email), phone: Boolean(contact.phone) },
        systemMessage: "Thanks. We'll get back to you using the details you left.",
      });
      return {
        conversation: await transaction.conversation.findUniqueOrThrow({
          where: { id: input.conversationId },
        }),
        ...timeline,
      };
    });
    if (!outcome) throw await this.followUpRefusal(identity, input.conversationId);
    if (outcome.message)
      this.routing.publishTimelineMessage(outcome.message, outcome.conversation.visitorId);
    return this.publishOperation(outcome.conversation, outcome.event, 'FOLLOW_UP_REQUESTED');
  }

  private async advance(
    candidate: {
      id: string;
      businessId: string;
      overflowLevel: number;
      topic: { overflowSteps: unknown } | null;
      queueEntry: { enqueuedAt: Date } | null;
    },
    now: Date,
  ): Promise<boolean> {
    const steps = overflowSteps(candidate.topic?.overflowSteps);
    const enqueuedAt = candidate.queueEntry?.enqueuedAt ?? null;
    const level = enqueuedAt
      ? Math.max(
          candidate.overflowLevel,
          dueOverflowLevel(steps, now.getTime() - enqueuedAt.getTime()),
        )
      : candidate.overflowLevel;
    const raised = level > candidate.overflowLevel;
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.conversation.updateMany({
        where: {
          id: candidate.id,
          businessId: candidate.businessId,
          ...WAITING,
          overflowLevel: candidate.overflowLevel,
          nextOverflowAt: { lte: now },
        },
        data: {
          overflowLevel: level,
          // Steps edited since this was scheduled may leave nothing further to do.
          nextOverflowAt: enqueuedAt ? nextOverflowAt(steps, level, enqueuedAt) : null,
          // A new routing cycle: consultants who refused at a narrower level may now take it.
          ...(raised ? { routingCycleStartedAt: now } : {}),
        },
      });
      if (changed.count !== 1 || !raised) return null;
      const timeline = await this.timeline.recordInTransaction(transaction, {
        businessId: candidate.businessId,
        conversationId: candidate.id,
        type: 'OVERFLOWED',
        actorType: 'SYSTEM',
        metadata: { fromLevel: candidate.overflowLevel, toLevel: level },
      });
      return {
        conversation: await transaction.conversation.findUniqueOrThrow({
          where: { id: candidate.id },
        }),
        event: timeline.event,
      };
    });
    if (!outcome) return false;
    await this.publishOperation(outcome.conversation, outcome.event, 'OVERFLOWED');
    return true;
  }

  private async followUpRefusal(
    identity: { businessId: string; visitorId: string },
    conversationId: string,
  ): Promise<Error> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, businessId: identity.businessId, visitorId: identity.visitorId },
      select: { followUpRequestedAt: true, intakeStatus: true },
    });
    if (!conversation)
      return new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    if (conversation.followUpRequestedAt)
      return new ConflictException({
        code: 'FOLLOW_UP_ALREADY_REQUESTED',
        message: 'We already have your details',
      });
    if (
      conversation.intakeStatus === 'AWAITING_TOPIC' ||
      conversation.intakeStatus === 'AWAITING_FORM'
    )
      return new ConflictException({
        code: 'INTAKE_PENDING',
        message: 'Finish the questions above first',
      });
    return new ConflictException({
      code: 'FOLLOW_UP_UNAVAILABLE',
      message: 'A consultant is already handling this conversation',
    });
  }

  private async publishOperation(
    conversation: Conversation,
    event: ConversationEvent,
    operation: 'OVERFLOWED' | 'FOLLOW_UP_REQUESTED',
  ): Promise<ConversationResponse> {
    const response = await this.routing.conversationResponse(conversation, null, null);
    this.events.emit(CONVERSATION_OPERATION_EVENT, {
      businessId: conversation.businessId,
      visitorId: conversation.visitorId,
      conversation: response,
      event: this.timeline.serialize(event),
      operation,
      previousAssignedAgentMembershipId: null,
      assignedAgentMembershipId: null,
    } satisfies ConversationOperationApplicationEvent);
    return response;
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
