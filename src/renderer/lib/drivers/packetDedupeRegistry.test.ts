import { describe, expect, it } from 'vitest';

import { createPacketDedupeRegistry } from './packetDedupeRegistry';

describe('createPacketDedupeRegistry', () => {
  it('reports the first sighting as new and repeats as seen', () => {
    const registry = createPacketDedupeRegistry({ ttlMs: 1000, maxEntries: 10 });
    expect(registry.markSeen(42, 0)).toBe(false);
    expect(registry.markSeen(42, 100)).toBe(true);
    expect(registry.markSeen(43, 100)).toBe(false);
  });

  it('treats numeric and string forms of a key as the same packet', () => {
    const registry = createPacketDedupeRegistry({ ttlMs: 1000, maxEntries: 10 });
    expect(registry.markSeen(7, 0)).toBe(false);
    expect(registry.markSeen('7', 0)).toBe(true);
  });

  it('forgets keys once the TTL elapses', () => {
    const registry = createPacketDedupeRegistry({ ttlMs: 1000, maxEntries: 10 });
    registry.markSeen('a', 0);
    expect(registry.hasSeen('a', 999)).toBe(true);
    expect(registry.hasSeen('a', 1000)).toBe(false);
    expect(registry.markSeen('a', 1000)).toBe(false);
  });

  it('keeps a repeatedly seen key alive relative to its last sighting', () => {
    const registry = createPacketDedupeRegistry({ ttlMs: 1000, maxEntries: 10 });
    registry.markSeen('a', 0);
    expect(registry.markSeen('a', 900)).toBe(true);
    expect(registry.hasSeen('a', 1500)).toBe(true);
  });

  it('evicts the oldest keys past maxEntries', () => {
    const registry = createPacketDedupeRegistry({ ttlMs: 60_000, maxEntries: 3 });
    for (const key of ['a', 'b', 'c', 'd']) registry.markSeen(key, 0);
    expect(registry.size(0)).toBe(3);
    expect(registry.hasSeen('a', 0)).toBe(false);
    expect(registry.hasSeen('d', 0)).toBe(true);
  });

  it('hasSeen does not record the key', () => {
    const registry = createPacketDedupeRegistry({ ttlMs: 1000, maxEntries: 10 });
    expect(registry.hasSeen('a', 0)).toBe(false);
    expect(registry.markSeen('a', 0)).toBe(false);
  });

  it('clear drops all retained keys', () => {
    const registry = createPacketDedupeRegistry({ ttlMs: 1000, maxEntries: 10 });
    registry.markSeen('a', 0);
    registry.clear();
    expect(registry.size(0)).toBe(0);
  });
});
