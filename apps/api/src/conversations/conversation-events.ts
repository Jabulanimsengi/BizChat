import type {
  ConversationOperationEvent,
  ConversationResponse,
  MessageReceiptEvent,
  MessageResponse,
} from '@bizchat/types';

export const CONVERSATION_CREATED_EVENT = 'conversation.created';
export const MESSAGE_CREATED_EVENT = 'message.created';
export const MESSAGE_RECEIPT_EVENT = 'message.receipt';
export const CONVERSATION_OPERATION_EVENT = 'conversation.operation';

export interface ConversationCreatedApplicationEvent {
  businessId: string;
  visitorId: string;
  conversation: ConversationResponse;
}

export interface MessageCreatedApplicationEvent {
  businessId: string;
  visitorId: string | null;
  message: MessageResponse;
}

export interface MessageReceiptApplicationEvent {
  businessId: string;
  conversationId: string;
  receipt: MessageReceiptEvent;
}

export interface ConversationOperationApplicationEvent extends ConversationOperationEvent {
  businessId: string;
  visitorId: string | null;
}
