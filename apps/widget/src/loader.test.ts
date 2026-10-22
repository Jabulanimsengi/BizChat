import { describe, expect, it } from 'vitest';
import { formatBytes, formatTime } from './loader';

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
});
