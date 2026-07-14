import { describe, expect, it } from 'vitest';

import {
  LARGE_MESH_NODE_THRESHOLD,
  MAX_DIAGNOSTICS_TRACKED_NODES,
  MAX_MESH_ENTITY_CAP,
  MAX_RETICULUM_IDENTITY_DESTINATIONS,
  MAX_RMAP_DISCOVERED_ROWS,
  trimArrayTail,
  trimMapToMaxSize,
  trimMapToMaxSizeKeeping,
} from './sessionMemoryCaps';

describe('sessionMemoryCaps', () => {
  it('aligns product caps at 10k', () => {
    expect(MAX_MESH_ENTITY_CAP).toBe(100_000);
    expect(MAX_DIAGNOSTICS_TRACKED_NODES).toBe(MAX_MESH_ENTITY_CAP);
    expect(MAX_RETICULUM_IDENTITY_DESTINATIONS).toBe(MAX_MESH_ENTITY_CAP);
    expect(MAX_RMAP_DISCOVERED_ROWS).toBe(2_000);
    expect(LARGE_MESH_NODE_THRESHOLD).toBe(2000);
  });

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
