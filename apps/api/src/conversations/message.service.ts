import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type Attachment,
  type Message,
  type MessageReceipt,
  type MessageSenderType,
  type MessageType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface CreateMessageCommand {
  businessId: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderUserId?: string;
  integrationKeyId?: string;
  senderVisitorId?: string;
  senderCustomerId?: string;
  clientMessageId: string;
  messageType?: MessageType;
  content?: string;
  attachment?: {
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

export type MessageWithRelations = Message & {
  receipts: MessageReceipt[];
  attachments: Attachment[];
};
export interface CreatedMessageResult {
  message: MessageWithRelations;
  created: boolean;
}

@Injectable()
export class MessageService {
  public constructor(private readonly prisma: PrismaService) {}

  public async append(command: CreateMessageCommand): Promise<CreatedMessageResult> {
    try {
      return await this.prisma.$transaction((transaction) =>
        this.createInTransaction(transaction, command),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findDuplicate(command);
        if (existing) return { message: existing, created: false };
      }
      throw error;
    }
  }

  public async createInTransaction(
    transaction: Prisma.TransactionClient,
    command: CreateMessageCommand,
  ): Promise<CreatedMessageResult> {
    const duplicate = await transaction.message.findFirst({
      where: {
        businessId: command.businessId,
        conversationId: command.conversationId,
        clientMessageId: command.clientMessageId,
      },
      include: { receipts: true, attachments: true },
    });
    if (duplicate) return { message: duplicate, created: false };
    const conversation = await transaction.conversation.update({
      where: { id: command.conversationId, businessId: command.businessId },
      data: { nextSequence: { increment: 1 }, lastMessageAt: new Date() },
      select: { nextSequence: true },
    });
    const message = await transaction.message.create({
      data: {
        businessId: command.businessId,
        conversationId: command.conversationId,
        senderType: command.senderType,
        integrationKeyId: command.integrationKeyId,
        senderUserId: command.senderUserId,
        senderVisitorId: command.senderVisitorId,
        senderCustomerId: command.senderCustomerId,
        clientMessageId: command.clientMessageId,
        sequenceNumber: conversation.nextSequence,
        messageType: command.messageType ?? 'TEXT',
        content: command.content,
        ...(command.attachment
          ? {
              attachments: {
                create: {
                  businessId: command.businessId,
                  conversationId: command.conversationId,
                  ...command.attachment,
                },
              },
            }
          : {}),
      },
      include: { receipts: true, attachments: true },
    });
    if (command.senderType === 'AGENT' && command.messageType !== 'INTERNAL_NOTE')
      await transaction.conversation.updateMany({
        where: {
          id: command.conversationId,
          businessId: command.businessId,
          firstResponseAt: null,
        },
        data: { firstResponseAt: message.createdAt },
      });
    return { message, created: true };
  }

  public findDuplicate(
    command: Pick<CreateMessageCommand, 'businessId' | 'conversationId' | 'clientMessageId'>,
  ): Promise<MessageWithRelations | null> {
    return this.prisma.message.findFirst({
      where: {
        businessId: command.businessId,
        conversationId: command.conversationId,
        clientMessageId: command.clientMessageId,
      },
      include: { receipts: true, attachments: true },
    });
  }
}
