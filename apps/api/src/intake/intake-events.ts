import type { IntakePrompt } from '@bizchat/types';

/** A connected visitor must complete an intake step the server started (e.g. a form after timeout). */
export const INTAKE_REQUIRED_EVENT = 'intake.required';

export interface IntakeRequiredApplicationEvent {
  businessId: string;
  conversationId: string;
  prompt: IntakePrompt;
}
