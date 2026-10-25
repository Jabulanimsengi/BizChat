import { describe, expect, it } from 'vitest';
import { formatDuration, formatRate, localDate } from './analytics-dashboard';

describe('analytics formatting', () => {
  it('formats durations for people', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(180)).toBe('3 min');
    expect(formatDuration(3_600)).toBe('1 h');
    expect(formatDuration(4_800)).toBe('1 h 20 min');
  });

  it('shows a rate only when there is a whole', () => {
    expect(formatRate(1, 3)).toBe('33%');
    expect(formatRate(0, 0)).toBe('—');
  });

  it('counts local days back from today', () => {
    const now = new Date(2026, 9, 25, 23, 30);
    expect(localDate(0, now)).toBe('2026-10-25');
    expect(localDate(6, now)).toBe('2026-10-19');
  });
});
