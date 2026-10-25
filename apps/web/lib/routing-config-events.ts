/** Fired after skills or pre-chat forms change, so other Routing page sections reload their lists. */
export const ROUTING_CONFIG_CHANGED = 'bizchat:routing-config-changed';

export function announceRoutingConfigChange(): void {
  window.dispatchEvent(new CustomEvent(ROUTING_CONFIG_CHANGED));
}
