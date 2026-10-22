import { ConversationTimelineService } from './conversation-timeline.service';

describe('ConversationTimelineService', () => {
  it('persists a timeline event and a sequenced system message in one transaction', async () => {
    const event = {
      id: 'event-1',
      businessId: 'business-1',
      conversationId: 'conversation-1',
      type: 'RESOLVED',
      actorType: 'BUSINESS_USER',
      actorId: 'user-1',
      metadata: {},
      createdAt: new Date(),
    };
    const message = {
      id: 'message-1',
      conversationId: 'conversation-1',
      sequenceNumber: 9n,
      receipts: [],
    };
    const transaction = {
      conversationEvent: { create: jest.fn().mockResolvedValue(event) },
      conversation: { update: jest.fn().mockResolvedValue({ nextSequence: 9n }) },
      message: { create: jest.fn().mockResolvedValue(message) },
    };
    const service = new ConversationTimelineService();
    const result = await service.recordInTransaction(transaction as never, {
      businessId: 'business-1',
      conversationId: 'conversation-1',
      type: 'RESOLVED',
      actorType: 'BUSINESS_USER',
      actorId: 'user-1',
      systemMessage: 'Conversation marked resolved.',
    });
    expect(result).toEqual({ event, message });
    expect(transaction.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { nextSequence: { increment: 1 }, lastMessageAt: expect.any(Date) as Date },
      }),
    );
    expect(transaction.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          senderType: 'SYSTEM',
          messageType: 'SYSTEM_EVENT',
          sequenceNumber: 9n,
        }) as unknown,
      }),
    );
  });

  it('records private timeline metadata without creating a customer-visible system message', async () => {
    const event = {
      id: 'event-2',
      businessId: 'business-1',
      conversationId: 'conversation-1',
      type: 'INTERNAL_NOTE_ADDED',
      actorType: 'BUSINESS_USER',
      actorId: 'user-1',
      metadata: {},
      createdAt: new Date(),
    };
    const transaction = {
      conversationEvent: { create: jest.fn().mockResolvedValue(event) },
      conversation: { update: jest.fn() },
      message: { create: jest.fn() },
    };
    const service = new ConversationTimelineService();
    const result = await service.recordInTransaction(transaction as never, {
      businessId: 'business-1',
      conversationId: 'conversation-1',
      type: 'INTERNAL_NOTE_ADDED',
      actorType: 'BUSINESS_USER',
      actorId: 'user-1',
    });
    expect(result.message).toBeNull();
    expect(transaction.message.create).not.toHaveBeenCalled();
  });
});
