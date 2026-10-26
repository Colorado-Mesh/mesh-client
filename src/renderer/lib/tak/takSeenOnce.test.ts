import { describe, expect, it } from 'vitest';

import { isFirstSeen } from './takSeenOnce';

describe('isFirstSeen', () => {
  it('passes a key once within the window, and again after it', () => {
    const seen = new Map<string, number>();
    expect(isFirstSeen(seen, 'a', 0, 100, 10)).toBe(true);
    expect(isFirstSeen(seen, 'a', 99, 100, 10)).toBe(false);
    expect(isFirstSeen(seen, 'a', 100, 100, 10)).toBe(true);
  });

  it('still catches a repeat of the oldest key when full', () => {
    const seen = new Map<string, number>();
    for (const k of ['a', 'b', 'c']) isFirstSeen(seen, k, 0, 100, 3);
    expect(isFirstSeen(seen, 'a', 1, 100, 3)).toBe(false);
    expect([...seen.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('makes room for a new key by dropping the oldest', () => {
    const seen = new Map<string, number>();
    for (const k of ['a', 'b', 'c']) isFirstSeen(seen, k, 0, 100, 3);
    expect(isFirstSeen(seen, 'd', 1, 100, 3)).toBe(true);
    expect([...seen.keys()]).toEqual(['b', 'c', 'd']);
  });

  it('drops expired keys first', () => {
    const seen = new Map<string, number>();
    isFirstSeen(seen, 'a', 0, 100, 3);
    isFirstSeen(seen, 'b', 50, 100, 3);
    isFirstSeen(seen, 'c', 120, 100, 3);
    expect([...seen.keys()]).toEqual(['b', 'c']);
  });
});
