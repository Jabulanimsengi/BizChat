import type { ConversationRoutingEvent } from '@bizchat/types';

export const CONVERSATION_ROUTED_EVENT = 'conversation.routed';
export const CONVERSATION_CAPACITY_RELEASED_EVENT = 'conversation.capacity_released';

export interface ConversationRoutedApplicationEvent extends ConversationRoutingEvent {
  businessId: string;
  visitorId: string | null;
}
export interface ConversationCapacityReleasedApplicationEvent {
  businessId: string;
  agentMembershipId: string | null;
  conversationId: string;
}
