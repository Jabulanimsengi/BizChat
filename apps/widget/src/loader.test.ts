import { describe, expect, it } from 'vitest';
import type { ConversationRoutingEvent } from '@bizchat/types';
import { formatBytes, formatTime, queuePositionText } from './loader';

describe('widget helpers', () => {
  it('formats byte sizes into a compact label', () => {
    expect(formatBytes(0)).toBe('1 KB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB');
  });

  it('formats timestamps without throwing', () => {
    expect(typeof formatTime(new Date().toISOString())).toBe('string');
    expect(formatTime(new Date().toISOString()).length).toBeGreaterThan(0);
  });

  it('registers the custom element exactly once', () => {
    expect(customElements.get('bizchat-widget')).toBeDefined();
  });

  it('words the queue position loosely once a chat has overflowed', () => {
    const queued = (queuePosition: number, overflowLevel: number): ConversationRoutingEvent =>
      ({ queuePosition, conversation: { overflowLevel } }) as ConversationRoutingEvent;
    expect(queuePositionText(queued(3, 0))).toBe(' You are number 3.');
    expect(queuePositionText(queued(1, 1))).toBe(" You're next.");
    expect(queuePositionText(queued(4, 2))).toBe(' About 3 ahead of you.');
  });
});
