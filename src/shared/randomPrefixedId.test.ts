import { describe, expect, it } from 'vitest';

import { randomPrefixedId } from './randomPrefixedId';

describe('randomPrefixedId', () => {
  it('includes the prefix and a timestamp segment', () => {
    const id = randomPrefixedId('meshcore');
    expect(id.startsWith('meshcore-')).toBe(true);
    const [, ts] = id.split('-');
    expect(Number(ts)).toBeGreaterThan(0);
  });

  it('returns different values on successive calls', () => {
    const a = randomPrefixedId('id');
    const b = randomPrefixedId('id');
    expect(a).not.toBe(b);
  });
});
