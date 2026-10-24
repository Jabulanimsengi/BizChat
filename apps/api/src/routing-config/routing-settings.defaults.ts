import type { RoutingSettingsResponse } from '@bizchat/types';

/** Applies to tenants with no stored row: direct assignment, as before Phase B. */
export const DEFAULT_ROUTING_SETTINGS: RoutingSettingsResponse = {
  routingStrategy: 'LEAST_BUSY',
  assignmentMode: 'AUTO',
  offerTimeoutSeconds: 30,
  missedOffersBeforeAway: 2,
  exclusionSeconds: 300,
  autoRouteThreshold: 0.6,
  confirmThreshold: 0.35,
  topicPromptTimeoutSeconds: 60,
};
