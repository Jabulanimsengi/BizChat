import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins class values and drops falsy entries', () => {
    expect(cn('a', false, undefined, 'b')).toBe('a b');
  });

  it('merges conflicting tailwind utilities with the last value winning', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-ink', 'text-white')).toBe('text-white');
  });
});
