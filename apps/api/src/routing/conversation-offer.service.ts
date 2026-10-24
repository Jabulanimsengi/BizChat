import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import type { AssignmentType, Conversation, OfferOutcome } from '@prisma/client';
import type { ConversationOfferEvent, ConversationRoutingEvent } from '@bizchat/types';
import type { AuthContext } from '../common/http.types';
import { ConversationTimelineService } from '../conversations/conversation-timeline.service';
import { PrismaService } from '../database/prisma.service';
import { PresenceService } from '../realtime/presence.service';
import { ConversationRoutingService } from './conversation-routing.service';
import {
  AGENT_SET_AWAY_EVENT,
  CONVERSATION_CAPACITY_RELEASED_EVENT,
  CONVERSATION_OFFER_WITHDRAWN_EVENT,
  CONVERSATION_OFFERED_EVENT,
  type AgentSetAwayApplicationEvent,
  type ConversationCapacityReleasedApplicationEvent,
  type ConversationOfferedApplicationEvent,
  type ConversationOfferWithdrawnApplicationEvent,
} from './routing-events';

/** Lets a slightly late timer find the offer already past its expiry. */
const EXPIRY_GRACE_MS = 250;
const EXPIRY_BATCH_SIZE = 200;
const DEFAULT_MISSED_OFFERS_BEFORE_AWAY = 2;

type ReleaseOutcome = Exclude<OfferOutcome, 'ACCEPTED'>;
interface ReleasedOffer {
  conversation: Conversation;
  offerId: string;
  agentProfileId: string;
  agentMembershipId: string;
}

/**
 * Accept, decline, expiry, and cancellation of conversation offers. Every transition is a
 * conditional update on the conversation's current offer, so concurrent actors produce one winner.
 */
@Injectable()
export class ConversationOfferService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationOfferService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  public constructor(
    private readonly prisma: PrismaService,
    private readonly routing: ConversationRoutingService,
    private readonly presence: PresenceService,
    private readonly timeline: ConversationTimelineService,
    private readonly events: EventEmitter2,
  ) {}

  /** The instance that made the offer expires it on time; the reliability sweep is the backstop. */
  @OnEvent(CONVERSATION_OFFERED_EVENT)
  public scheduleExpiry(event: ConversationOfferedApplicationEvent): void {
    const delay = Math.max(0, new Date(event.expiresAt).getTime() - Date.now() + EXPIRY_GRACE_MS);
    const timer = setTimeout(() => {
      this.timers.delete(event.offerId);
      void this.expire(event.businessId, event.conversation.id, event.offerId).catch(
        (error: unknown) =>
          this.logger.warn(
            `Offer expiry failed for ${event.offerId}: ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    }, delay);
    timer.unref();
    this.timers.set(event.offerId, timer);
  }

  public onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Offers still waiting for this consultant, re-sent when their dashboard reconnects. */
  public async pendingFor(
    businessId: string,
    membershipId: string,
  ): Promise<ConversationOfferEvent[]> {
    const offered = await this.prisma.conversation.findMany({
      where: {
        businessId,
        status: 'OFFERED',
        assignedAgentMembershipId: membershipId,
        offerExpiresAt: { gt: new Date() },
      },
      orderBy: { offerExpiresAt: 'asc' },
    });
    return Promise.all(offered.map((conversation) => this.routing.offerEvent(conversation)));
  }

  public async accept(auth: AuthContext, offerId: string): Promise<ConversationRoutingEvent> {
    const offer = await this.ownedOffer(auth, offerId);
    const now = new Date();
    const accepted = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.conversation.updateMany({
        where: {
          id: offer.conversationId,
          businessId: auth.business.id,
          status: 'OFFERED',
          currentOfferId: offerId,
          assignedAgentMembershipId: auth.membership.id,
          offerExpiresAt: { gt: now },
        },
        data: { status: 'ASSIGNED', assignedAt: now, currentOfferId: null, offerExpiresAt: null },
      });
      if (claimed.count !== 1) return null;
      await transaction.conversationOffer.update({
        where: { id: offerId },
        data: { outcome: 'ACCEPTED', respondedAt: now },
      });
      await transaction.agentProfile.update({
        where: { id: offer.agentProfileId },
        data: { missedOfferStreak: 0 },
      });
      const conversation = await transaction.conversation.findUniqueOrThrow({
        where: { id: offer.conversationId },
      });
      const timeline = await this.routing.recordAssignmentInTransaction(
        transaction,
        conversation,
        {
          id: offer.agentProfileId,
          membershipId: auth.membership.id,
          userId: auth.user.id,
          displayName: auth.user.displayName,
        },
        offer.assignmentType,
        now,
      );
      return { conversation, timeline };
    });
    if (!accepted)
      throw new ConflictException({
        code: 'OFFER_NO_LONGER_AVAILABLE',
        message: 'This chat is no longer offered to you',
      });
    this.clearTimer(offerId);
    if (accepted.timeline.message)
      this.routing.publishTimelineMessage(
        accepted.timeline.message,
        accepted.conversation.visitorId,
      );
    // Other dashboard tabs of the same consultant drop the card.
    this.emitWithdrawn(
      auth.business.id,
      auth.membership.id,
      offerId,
      offer.conversationId,
      'ACCEPTED',
    );
    return this.routing.publish(accepted.conversation, 'ASSIGNED');
  }

  public async decline(auth: AuthContext, offerId: string, reason?: string): Promise<void> {
    const offer = await this.ownedOffer(auth, offerId);
    const released = await this.release(
      auth.business.id,
      offer.conversationId,
      offerId,
      'DECLINED',
      reason,
    );
    if (!released)
      throw new ConflictException({
        code: 'OFFER_NO_LONGER_AVAILABLE',
        message: 'This chat is no longer offered to you',
      });
    await this.reroute(released, 'DECLINED');
  }

  /** Returns false when the offer was already accepted, declined, or replaced. */
  public async expire(
    businessId: string,
    conversationId: string,
    offerId: string,
  ): Promise<boolean> {
    const released = await this.release(businessId, conversationId, offerId, 'EXPIRED');
    if (!released) return false;
    await this.recordMissedOffer(businessId, released);
    await this.reroute(released, 'EXPIRED');
    return true;
  }

  /** A consultant who disconnects loses pending offers at once; there is no grace period. */
  public async cancelForAgent(businessId: string, membershipId: string): Promise<number> {
    const offered = await this.prisma.conversation.findMany({
      where: { businessId, status: 'OFFERED', assignedAgentMembershipId: membershipId },
      select: { id: true, currentOfferId: true },
    });
    let cancelled = 0;
    for (const conversation of offered) {
      if (!conversation.currentOfferId) continue;
      const released = await this.release(
        businessId,
        conversation.id,
        conversation.currentOfferId,
        'CANCELLED',
        'AGENT_DISCONNECTED',
      );
      if (!released) continue;
      cancelled += 1;
      await this.reroute(released, 'CANCELLED');
    }
    return cancelled;
  }

  /** Reliability-sweep backstop for offers whose timer was lost (for example, an instance stopped). */
  public async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.conversation.findMany({
      where: { status: 'OFFERED', offerExpiresAt: { lte: now } },
      orderBy: { offerExpiresAt: 'asc' },
      take: EXPIRY_BATCH_SIZE,
      select: { id: true, businessId: true, currentOfferId: true },
    });
    let expired = 0;
    for (const conversation of due) {
      if (!conversation.currentOfferId) continue;
      if (await this.expire(conversation.businessId, conversation.id, conversation.currentOfferId))
        expired += 1;
    }
    return expired;
  }

  private async ownedOffer(
    auth: AuthContext,
    offerId: string,
  ): Promise<{ conversationId: string; agentProfileId: string; assignmentType: AssignmentType }> {
    const offer = await this.prisma.conversationOffer.findFirst({
      where: {
        id: offerId,
        businessId: auth.business.id,
        agentProfile: { membershipId: auth.membership.id },
      },
      select: { conversationId: true, agentProfileId: true, assignmentType: true },
    });
    if (!offer)
      throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
    return offer;
  }

  private async release(
    businessId: string,
    conversationId: string,
    offerId: string,
    outcome: ReleaseOutcome,
    reason?: string,
  ): Promise<ReleasedOffer | null> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const released = await transaction.conversation.updateMany({
        where: { id: conversationId, businessId, status: 'OFFERED', currentOfferId: offerId },
        data: {
          status: 'QUEUED',
          assignedAgentMembershipId: null,
          currentOfferId: null,
          offerExpiresAt: null,
        },
      });
      if (released.count !== 1) return null;
      const offer = await transaction.conversationOffer.update({
        where: { id: offerId },
        data: { outcome, respondedAt: now, reason: reason ?? null },
        select: {
          offeredAt: true,
          agentProfileId: true,
          agentProfile: { select: { membershipId: true } },
        },
      });
      const conversation = await transaction.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      // A conversation offered straight from NEW has no queue entry yet; its wait began at the offer.
      await transaction.conversationQueueEntry.upsert({
        where: { conversationId },
        update: { assignedAt: null, removedAt: null },
        create: {
          businessId,
          conversationId,
          departmentId: conversation.departmentId,
          priority: conversation.priority,
          enqueuedAt: offer.offeredAt,
          attempts: 0,
        },
      });
      await this.timeline.recordInTransaction(transaction, {
        businessId,
        conversationId,
        type: 'QUEUED',
        actorType: 'SYSTEM',
        metadata: { reason: `OFFER_${outcome}`, offerId, agentProfileId: offer.agentProfileId },
      });
      return {
        conversation,
        offerId,
        agentProfileId: offer.agentProfileId,
        agentMembershipId: offer.agentProfile.membershipId,
      };
    });
  }

  private async reroute(released: ReleasedOffer, outcome: ReleaseOutcome): Promise<void> {
    const { conversation } = released;
    this.clearTimer(released.offerId);
    this.emitWithdrawn(
      conversation.businessId,
      released.agentMembershipId,
      released.offerId,
      conversation.id,
      outcome,
    );
    // Offer it to the next eligible consultant (the previous one is now excluded), then let the
    // freed capacity drain the rest of the queue.
    await this.routing.routeConversation(conversation.businessId, conversation.id);
    this.events.emit(CONVERSATION_CAPACITY_RELEASED_EVENT, {
      businessId: conversation.businessId,
      agentMembershipId: released.agentMembershipId,
      conversationId: conversation.id,
    } satisfies ConversationCapacityReleasedApplicationEvent);
  }

  private async recordMissedOffer(businessId: string, released: ReleasedOffer): Promise<void> {
    const [profile, settings] = await Promise.all([
      this.prisma.agentProfile.update({
        where: { id: released.agentProfileId },
        data: { missedOfferStreak: { increment: 1 } },
        select: { missedOfferStreak: true },
      }),
      this.prisma.routingSettings.findUnique({
        where: { businessId },
        select: { missedOffersBeforeAway: true },
      }),
    ]);
    const threshold = settings?.missedOffersBeforeAway ?? DEFAULT_MISSED_OFFERS_BEFORE_AWAY;
    if (threshold === 0 || profile.missedOfferStreak < threshold) return;
    await this.prisma.agentProfile.update({
      where: { id: released.agentProfileId },
      data: { missedOfferStreak: 0 },
    });
    if ((await this.presence.getAgentState(businessId, released.agentProfileId)) !== 'ONLINE')
      return;
    await this.presence.setAgentState(businessId, released.agentProfileId, 'AWAY');
    this.events.emit(AGENT_SET_AWAY_EVENT, {
      businessId,
      agentProfileId: released.agentProfileId,
      agentMembershipId: released.agentMembershipId,
      message: `You were set to Away after missing ${profile.missedOfferStreak} chat offers in a row. Set yourself Online when you're ready.`,
    } satisfies AgentSetAwayApplicationEvent);
  }

  private emitWithdrawn(
    businessId: string,
    agentMembershipId: string,
    offerId: string,
    conversationId: string,
    reason: ConversationOfferWithdrawnApplicationEvent['reason'],
  ): void {
    this.events.emit(CONVERSATION_OFFER_WITHDRAWN_EVENT, {
      businessId,
      agentMembershipId,
      offerId,
      conversationId,
      reason,
    } satisfies ConversationOfferWithdrawnApplicationEvent);
  }

  private clearTimer(offerId: string): void {
    const timer = this.timers.get(offerId);
    if (timer) clearTimeout(timer);
    this.timers.delete(offerId);
  }
}
