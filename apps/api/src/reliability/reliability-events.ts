import type { ConversationRecoveryEvent } from '@bizchat/types';

export const CONVERSATION_RECOVERY_EVENT = 'conversation.recovery';

export interface ConversationRecoveryApplicationEvent extends ConversationRecoveryEvent {
  businessId: string;
  visitorId: string | null;
}
