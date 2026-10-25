import { describe, expect, it } from 'vitest';
import { parseKeywords } from './topic-manager';

describe('parseKeywords', () => {
  it('reads one keyword per line with an optional weight', () => {
    expect(parseKeywords('register\n new company | 3 \n\nincorporate|9')).toEqual([
      { phrase: 'register' },
      { phrase: 'new company', weight: 3 },
      // Out-of-range weights fall back to the default rather than failing the save.
      { phrase: 'incorporate' },
    ]);
  });
});
