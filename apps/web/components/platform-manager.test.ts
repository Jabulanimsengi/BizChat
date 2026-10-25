import { describe, expect, it } from 'vitest';
import { usageText } from './plan-usage';
import { limitValue } from './platform-manager';

describe('plan formatting', () => {
  it('shows usage against a limit, or that there is none', () => {
    expect(usageText(12, 200)).toBe('12 of 200');
    expect(usageText(12, null)).toBe('12 (no limit)');
  });

  it('treats an empty limit as unlimited', () => {
    expect(limitValue('')).toBeNull();
    expect(limitValue('  ')).toBeNull();
    expect(limitValue('50')).toBe(50);
  });
});
