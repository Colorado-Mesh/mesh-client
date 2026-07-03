import { describe, expect, it } from 'vitest';

import { trimArrayTail, trimMapToMaxSize, trimMapToMaxSizeKeeping } from './sessionMemoryCaps';

describe('sessionMemoryCaps', () => {
  it('trimArrayTail keeps newest entries', () => {
    expect(trimArrayTail([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  it('trimMapToMaxSize evicts oldest keys', () => {
    const map = new Map<number, string>([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
    expect([...trimMapToMaxSize(map, 2).keys()]).toEqual([2, 3]);
  });

  it('trimMapToMaxSizeKeeping prefers retaining keepIds', () => {
    const map = new Map<number, string>([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
      [4, 'd'],
    ]);
    const trimmed = trimMapToMaxSizeKeeping(map, 2, [1, 4]);
    expect([...trimmed.keys()].sort()).toEqual([1, 4]);
  });
});
