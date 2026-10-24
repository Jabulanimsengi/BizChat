import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConversationOfferService } from './conversation-offer.service';

interface Mocks {
  service: ConversationOfferService;
  transaction: {
    conversation: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    conversationOffer: { update: jest.Mock };
    agentProfile: { update: jest.Mock };
    conversationQueueEntry: { upsert: jest.Mock };
  };
  prisma: {
    conversationOffer: { findFirst: jest.Mock };
    conversation: { findMany: jest.Mock };
    agentProfile: { update: jest.Mock };
    routingSettings: { findUnique: jest.Mock };
  };
  routing: Record<
    | 'recordAssignmentInTransaction'
    | 'publishTimelineMessage'
    | 'publish'
    | 'routeConversation'
    | 'offerEvent',
    jest.Mock
  >;
  presence: { getAgentState: jest.Mock; setAgentState: jest.Mock };
  timeline: { recordInTransaction: jest.Mock };
  emit: jest.Mock;
}

describe('ConversationOfferService', () => {
  const auth = {
    business: { id: 'business-1' },
    membership: { id: 'membership-1' },
    user: { id: 'user-1', displayName: 'Thandi' },
  } as never;
  const offeredAt = new Date('2026-10-24T09:00:00Z');
  const conversation = {
    id: 'conversation-1',
    businessId: 'business-1',
    visitorId: 'visitor-1',
    departmentId: 'sales',
    priority: 'NORMAL',
    status: 'QUEUED',
  };

  const setup = (
    options: { streak?: number; threshold?: number; presence?: string } = {},
  ): Mocks => {
    const transaction = {
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(conversation),
      },
      conversationOffer: {
        update: jest.fn().mockResolvedValue({
          offeredAt,
          agentProfileId: 'profile-1',
          agentProfile: { membershipId: 'membership-1' },
        }),
      },
      agentProfile: { update: jest.fn().mockResolvedValue({}) },
      conversationQueueEntry: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      conversationOffer: {
        findFirst: jest.fn().mockResolvedValue({
          conversationId: 'conversation-1',
          agentProfileId: 'profile-1',
          assignmentType: 'REASSIGNMENT',
        }),
      },
      conversation: { findMany: jest.fn().mockResolvedValue([]) },
      agentProfile: {
        update: jest.fn().mockResolvedValue({ missedOfferStreak: options.streak ?? 1 }),
      },
      routingSettings: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.threshold === undefined ? null : { missedOffersBeforeAway: options.threshold },
          ),
      },
      $transaction: jest.fn(async (operation: (client: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    };
    const routing = {
      recordAssignmentInTransaction: jest
        .fn()
        .mockResolvedValue({ event: {}, message: { id: 'system-message' } }),
      publishTimelineMessage: jest.fn(),
      publish: jest.fn().mockResolvedValue({ outcome: 'ASSIGNED' }),
      routeConversation: jest.fn().mockResolvedValue({ outcome: 'OFFERED' }),
      offerEvent: jest.fn(),
    };
    const presence = {
      getAgentState: jest.fn().mockResolvedValue(options.presence ?? 'ONLINE'),
      setAgentState: jest.fn().mockResolvedValue('AWAY'),
    };
    const timeline = {
      recordInTransaction: jest.fn().mockResolvedValue({ event: {}, message: null }),
    };
    const emit = jest.fn();
    const service = new ConversationOfferService(
      prisma as never,
      routing as never,
      presence as never,
      timeline as never,
      { emit } as never,
    );
    return { service, transaction, prisma, routing, presence, timeline, emit };
  };

  const emitted = (emit: jest.Mock, name: string): unknown[] =>
    emit.mock.calls.filter(([event]) => event === name).map(([, payload]) => payload as unknown);

  describe('accept', () => {
    it('assigns the conversation only while this offer is current and unexpired', async () => {
      const { service, transaction, routing, emit } = setup();

      await service.accept(auth, 'offer-1');

      expect(transaction.conversation.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'conversation-1',
          businessId: 'business-1',
          status: 'OFFERED',
          currentOfferId: 'offer-1',
          assignedAgentMembershipId: 'membership-1',
          offerExpiresAt: { gt: expect.any(Date) as Date },
        },
        data: expect.objectContaining({ status: 'ASSIGNED', currentOfferId: null }) as unknown,
      });
      expect(transaction.conversationOffer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { outcome: 'ACCEPTED', respondedAt: expect.any(Date) as Date },
        }),
      );
      expect(transaction.agentProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { missedOfferStreak: 0 } }),
      );
      // The assignment keeps the type the conversation was routed with.
      expect(routing.recordAssignmentInTransaction).toHaveBeenCalledWith(
        transaction,
        conversation,
        { id: 'profile-1', membershipId: 'membership-1', userId: 'user-1', displayName: 'Thandi' },
        'REASSIGNMENT',
        expect.any(Date),
      );
      expect(routing.publishTimelineMessage).toHaveBeenCalled();
      expect(routing.publish).toHaveBeenCalledWith(conversation, 'ASSIGNED');
      expect(emitted(emit, 'conversation.offer_withdrawn')).toEqual([
        expect.objectContaining({ offerId: 'offer-1', reason: 'ACCEPTED' }),
      ]);
    });

    it('reports a lost race (expired, declined, or reassigned) as no longer available', async () => {
      const { service, transaction, routing } = setup();
      transaction.conversation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.accept(auth, 'offer-1')).rejects.toBeInstanceOf(ConflictException);
      expect(transaction.conversationOffer.update).not.toHaveBeenCalled();
      expect(routing.publish).not.toHaveBeenCalled();
    });

    it("refuses another consultant's offer", async () => {
      const { service, prisma } = setup();
      prisma.conversationOffer.findFirst.mockResolvedValue(null);

      await expect(service.accept(auth, 'offer-other')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.conversationOffer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'offer-other',
            businessId: 'business-1',
            agentProfile: { membershipId: 'membership-1' },
          },
        }),
      );
    });
  });

  it('declining requeues the conversation from when it was first offered and re-offers it', async () => {
    const { service, transaction, routing, timeline, emit } = setup();

    await service.decline(auth, 'offer-1', 'Not my area');

    expect(transaction.conversation.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'conversation-1',
        businessId: 'business-1',
        status: 'OFFERED',
        currentOfferId: 'offer-1',
      },
      data: {
        status: 'QUEUED',
        assignedAgentMembershipId: null,
        currentOfferId: null,
        offerExpiresAt: null,
      },
    });
    expect(transaction.conversationOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { outcome: 'DECLINED', respondedAt: expect.any(Date) as Date, reason: 'Not my area' },
      }),
    );
    expect(transaction.conversationQueueEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { assignedAt: null, removedAt: null },
        create: expect.objectContaining({ enqueuedAt: offeredAt }) as unknown,
      }),
    );
    expect(timeline.recordInTransaction).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        type: 'QUEUED',
        metadata: expect.objectContaining({ reason: 'OFFER_DECLINED' }) as unknown,
      }),
    );
    expect(routing.routeConversation).toHaveBeenCalledWith('business-1', 'conversation-1');
    expect(emitted(emit, 'conversation.capacity_released')).toHaveLength(1);
    expect(emitted(emit, 'conversation.offer_withdrawn')).toEqual([
      expect.objectContaining({ reason: 'DECLINED', agentMembershipId: 'membership-1' }),
    ]);
  });

  it('does nothing when an offer expires after it was already answered', async () => {
    const { service, transaction, routing, prisma } = setup();
    transaction.conversation.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.expire('business-1', 'conversation-1', 'offer-1')).resolves.toBe(false);
    expect(prisma.agentProfile.update).not.toHaveBeenCalled();
    expect(routing.routeConversation).not.toHaveBeenCalled();
  });

  describe('missed offers', () => {
    it('sets an online consultant away once the streak reaches the threshold', async () => {
      const { service, prisma, presence, emit } = setup({ streak: 2, threshold: 2 });

      await expect(service.expire('business-1', 'conversation-1', 'offer-1')).resolves.toBe(true);

      expect(prisma.agentProfile.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'profile-1' },
        data: { missedOfferStreak: { increment: 1 } },
        select: { missedOfferStreak: true },
      });
      expect(prisma.agentProfile.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'profile-1' },
        data: { missedOfferStreak: 0 },
      });
      expect(presence.setAgentState).toHaveBeenCalledWith('business-1', 'profile-1', 'AWAY');
      expect(emitted(emit, 'agent.set_away')).toEqual([
        expect.objectContaining({ agentProfileId: 'profile-1', agentMembershipId: 'membership-1' }),
      ]);
    });

    it('uses a default threshold of 2 for tenants without stored settings', async () => {
      const { service, presence } = setup({ streak: 1 });
      await service.expire('business-1', 'conversation-1', 'offer-1');
      expect(presence.setAgentState).not.toHaveBeenCalled();

      const second = setup({ streak: 2 });
      await second.service.expire('business-1', 'conversation-1', 'offer-1');
      expect(second.presence.setAgentState).toHaveBeenCalled();
    });

    it('never sets anyone away when the threshold is 0', async () => {
      const { service, presence } = setup({ streak: 9, threshold: 0 });
      await service.expire('business-1', 'conversation-1', 'offer-1');
      expect(presence.setAgentState).not.toHaveBeenCalled();
    });

    it('leaves a consultant who already changed their own status alone', async () => {
      const { service, presence, emit } = setup({ streak: 2, threshold: 2, presence: 'BUSY' });
      await service.expire('business-1', 'conversation-1', 'offer-1');
      expect(presence.setAgentState).not.toHaveBeenCalled();
      expect(emitted(emit, 'agent.set_away')).toEqual([]);
    });
  });

  it('expires an offer on time from the offering instance', () => {
    jest.useFakeTimers();
    try {
      const { service } = setup();
      const expire = jest.spyOn(service, 'expire').mockResolvedValue(true);
      service.scheduleExpiry({
        businessId: 'business-1',
        agentMembershipId: 'membership-1',
        offerId: 'offer-1',
        conversation: { id: 'conversation-1' } as never,
        firstMessage: null,
        offeredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });

      jest.advanceTimersByTime(30_000);
      expect(expire).not.toHaveBeenCalled();
      jest.advanceTimersByTime(300);
      expect(expire).toHaveBeenCalledWith('business-1', 'conversation-1', 'offer-1');
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels a disconnected consultant's pending offers and re-offers them", async () => {
    const { service, prisma, transaction, routing } = setup();
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'conversation-1', currentOfferId: 'offer-1' },
      { id: 'conversation-2', currentOfferId: 'offer-2' },
    ]);

    await expect(service.cancelForAgent('business-1', 'membership-1')).resolves.toBe(2);

    expect(transaction.conversationOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: 'CANCELLED',
          reason: 'AGENT_DISCONNECTED',
        }) as unknown,
      }),
    );
    expect(routing.routeConversation).toHaveBeenCalledTimes(2);
  });

  it('expires overdue offers oldest first as the sweep backstop', async () => {
    const { service, prisma } = setup();
    prisma.conversation.findMany.mockResolvedValue([
      { id: 'conversation-1', businessId: 'business-1', currentOfferId: 'offer-1' },
    ]);
    const expire = jest.spyOn(service, 'expire').mockResolvedValue(true);

    await expect(service.expireDue()).resolves.toBe(1);
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'OFFERED', offerExpiresAt: { lte: expect.any(Date) as Date } },
        orderBy: { offerExpiresAt: 'asc' },
      }),
    );
    expect(expire).toHaveBeenCalledWith('business-1', 'conversation-1', 'offer-1');
  });
});
