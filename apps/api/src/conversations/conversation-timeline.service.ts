import { Injectable } from '@nestjs/common';
import type {
  ConversationEvent,
  ConversationEventActorType,
  ConversationEventType,
  Message,
  MessageReceipt,
  Prisma,
} from '@prisma/client';
import type { ConversationEventResponse } from '@bizchat/types';
import { randomUUID } from 'node:crypto';

export interface TimelineRecord {
  businessId: string;
  conversationId: string;
  type: ConversationEventType;
  actorType: ConversationEventActorType;
  actorId?: string;
  metadata?: Prisma.InputJsonValue;
  systemMessage?: string;
}

@Injectable()
export class ConversationTimelineService {
  public async recordInTransaction(
    transaction: Prisma.TransactionClient,
    input: TimelineRecord,
  ): Promise<{
    event: ConversationEvent;
    message: (Message & { receipts: MessageReceipt[] }) | null;
  }> {
    const event = await transaction.conversationEvent.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        type: input.type,
        actorType: input.actorType,
        actorId: input.actorId,
        metadata: input.metadata,
      },
    });
    if (!input.systemMessage) return { event, message: null };
    const conversation = await transaction.conversation.update({
      where: { id: input.conversationId, businessId: input.businessId },
      data: { nextSequence: { increment: 1 }, lastMessageAt: new Date() },
      select: { nextSequence: true },
    });
    const message = await transaction.message.create({
      data: {
        businessId: input.businessId,
        conversationId: input.conversationId,
        senderType: 'SYSTEM',
        clientMessageId: randomUUID(),
        sequenceNumber: conversation.nextSequence,
        messageType: 'SYSTEM_EVENT',
        content: input.systemMessage,
      },
      include: { receipts: true },
    });
    return { event, message };
  }

  public serialize(event: ConversationEvent): ConversationEventResponse {
    return {
      id: event.id,
      conversationId: event.conversationId,
      type: event.type,
      actorType: event.actorType,
      actorId: event.actorId,
      metadata: event.metadata as Record<string, unknown> | null,
      createdAt: event.createdAt.toISOString(),
    };
  }
}
