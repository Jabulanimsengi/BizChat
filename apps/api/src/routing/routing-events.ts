import type {
  ConversationOfferEvent,
  ConversationOfferWithdrawnEvent,
  ConversationRoutingEvent,
  ConversationWaitOptionsEvent,
} from '@bizchat/types';

export const CONVERSATION_ROUTED_EVENT = 'conversation.routed';
export const CONVERSATION_CAPACITY_RELEASED_EVENT = 'conversation.capacity_released';
export const CONVERSATION_OFFERED_EVENT = 'conversation.offered';
export const CONVERSATION_OFFER_WITHDRAWN_EVENT = 'conversation.offer_withdrawn';
export const AGENT_SET_AWAY_EVENT = 'agent.set_away';

export interface ConversationOfferedApplicationEvent extends ConversationOfferEvent {
  businessId: string;
  agentMembershipId: string;
}
export interface ConversationOfferWithdrawnApplicationEvent extends ConversationOfferWithdrawnEvent {
  businessId: string;
  agentMembershipId: string;
}
/** A consultant was set away by the server, e.g. after consecutive missed offers. */
export interface AgentSetAwayApplicationEvent {
  businessId: string;
  agentProfileId: string;
  agentMembershipId: string;
  message: string;
}

export interface ConversationRoutedApplicationEvent extends ConversationRoutingEvent {
  businessId: string;
  visitorId: string | null;
}
export interface ConversationCapacityReleasedApplicationEvent {
  businessId: string;
  agentMembershipId: string | null;
  conversationId: string;
}

/** A waiting visitor passed the topic's maximum wait and may leave details for a follow-up. */
export const CONVERSATION_WAIT_OPTIONS_EVENT = 'conversation.wait_options';
export interface ConversationWaitOptionsApplicationEvent extends ConversationWaitOptionsEvent {
  businessId: string;
}
