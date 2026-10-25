import type { Attachment, Conversation, Message, MessageReceipt } from '@prisma/client';
import type {
  AttachmentResponse,
  ConversationResponse,
  FollowUpContact,
  MessageResponse,
} from '@bizchat/types';

export function serializeConversation(conversation: Conversation): ConversationResponse {
  return {
    id: conversation.id,
    status: conversation.status,
    priority: conversation.priority,
    source: conversation.source,
    subject: conversation.subject,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    assignedAgentMembershipId: conversation.assignedAgentMembershipId,
    departmentId: conversation.departmentId,
    departmentName: null,
    topicId: conversation.topicId,
    topicName: null,
    intakeStatus: conversation.intakeStatus,
    overflowLevel: conversation.overflowLevel,
    maxWaitReachedAt: conversation.maxWaitNotifiedAt?.toISOString() ?? null,
    followUpRequestedAt: conversation.followUpRequestedAt?.toISOString() ?? null,
    followUpContact: conversation.followUpContact as FollowUpContact | null,
    queuedAt: null,
    queuePosition: null,
    resolvedAt: conversation.resolvedAt?.toISOString() ?? null,
    reopenedAt: conversation.reopenedAt?.toISOString() ?? null,
    tags: [],
    lastMessagePreview: null,
    unreadCount: 0,
  };
}

export function serializeMessage(
  message: Message & { receipts?: MessageReceipt[]; attachments?: Attachment[] },
): MessageResponse {
  const receipts = message.receipts ?? [];
  const deliveryState = receipts.some((receipt) => receipt.readAt)
    ? ('READ' as const)
    : receipts.some((receipt) => receipt.deliveredAt)
      ? ('DELIVERED' as const)
      : ('SENT' as const);
  return {
    id: message.id,
    conversationId: message.conversationId,
    clientMessageId: message.clientMessageId,
    sequenceNumber: message.sequenceNumber.toString(),
    senderType: message.senderType,
    messageType: message.messageType,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deliveryState,
    attachments: (message.attachments ?? [])
      .filter((attachment) => attachment.status === 'READY')
      .map(serializeAttachment),
  };
}

export function serializeAttachment(attachment: Attachment): AttachmentResponse {
  return {
    id: attachment.id,
    messageId: attachment.messageId,
    originalFileName: attachment.originalFileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    status: attachment.status,
    downloadUrl: `/api/v1/attachments/${attachment.id}/download`,
    createdAt: attachment.createdAt.toISOString(),
  };
}
