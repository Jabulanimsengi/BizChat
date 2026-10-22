import type { AgentPresenceEvent, TypingEvent, VisitorPresenceEvent } from '@bizchat/types';

export const AGENT_PRESENCE_EVENT = 'agent.presence.changed';
export const TYPING_CHANGED_EVENT = 'typing.changed';
export const VISITOR_PRESENCE_EVENT = 'visitor.presence.changed';

export interface AgentPresenceApplicationEvent extends AgentPresenceEvent {
  businessId: string;
}
export interface TypingApplicationEvent extends TypingEvent {
  businessId: string;
}
export interface VisitorPresenceApplicationEvent extends VisitorPresenceEvent {
  businessId: string;
  visitorId: string;
}
