import type { PrismaService } from '../database/prisma.service';
import { MessageService, type CreateMessageCommand } from './message.service';

describe('MessageService', () => {
  const command: CreateMessageCommand = {
    businessId: 'business-1',
    conversationId: 'conversation-1',
    senderType: 'VISITOR',
    senderVisitorId: 'visitor-1',
    clientMessageId: '11111111-1111-4111-8111-111111111111',
    content: 'Hello',
  };

  it('returns an existing message without allocating another sequence', async () => {
    const duplicate = { id: 'message-1', receipts: [], sequenceNumber: 4n };
    const transaction = {
      message: { findFirst: jest.fn().mockResolvedValue(duplicate), create: jest.fn() },
      conversation: { update: jest.fn(), updateMany: jest.fn() },
    };
    const service = new MessageService({} as PrismaService);
    const result = await service.createInTransaction(transaction as never, command);
    expect(result).toEqual({ message: duplicate, created: false });
    expect(transaction.conversation.update).not.toHaveBeenCalled();
    expect(transaction.message.create).not.toHaveBeenCalled();
  });

  it('uses the atomically incremented conversation sequence for a new message', async () => {
    const created = { id: 'message-2', receipts: [], sequenceNumber: 8n, createdAt: new Date() };
    const conversationUpdate = jest
      .fn<Promise<{ nextSequence: bigint }>, [unknown]>()
      .mockResolvedValue({ nextSequence: 8n });
    const messageCreate = jest.fn<Promise<typeof created>, [unknown]>().mockResolvedValue(created);
    const transaction = {
      message: { findFirst: jest.fn().mockResolvedValue(null), create: messageCreate },
      conversation: { update: conversationUpdate, updateMany: jest.fn() },
    };
    const service = new MessageService({} as PrismaService);
    const result = await service.createInTransaction(transaction as never, command);
    expect(result.created).toBe(true);
    const updateInput = conversationUpdate.mock.calls[0]?.[0] as {
      data: { nextSequence: { increment: number } };
    };
    const createInput = messageCreate.mock.calls[0]?.[0] as { data: { sequenceNumber: bigint } };
    expect(updateInput.data.nextSequence).toEqual({ increment: 1 });
    expect(createInput.data.sequenceNumber).toBe(8n);
  });

  it('does not count an internal note as the first agent response', async () => {
    const created = { id: 'message-note', receipts: [], sequenceNumber: 2n, createdAt: new Date() };
    const transaction = {
      message: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
      conversation: {
        update: jest.fn().mockResolvedValue({ nextSequence: 2n }),
        updateMany: jest.fn(),
      },
    };
    const service = new MessageService({} as PrismaService);
    await service.createInTransaction(transaction as never, {
      ...command,
      senderType: 'AGENT',
      senderUserId: 'user-1',
      senderVisitorId: undefined,
      messageType: 'INTERNAL_NOTE',
    });
    expect(transaction.conversation.updateMany).not.toHaveBeenCalled();
  });
});
