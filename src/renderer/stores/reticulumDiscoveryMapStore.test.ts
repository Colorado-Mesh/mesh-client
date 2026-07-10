import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_RMAP_DISCOVERED_ROWS } from '@/renderer/lib/sessionMemoryCaps';
import {
  mergeRmapDiscoveryRows,
  normalizeRmapDiscoveryRows,
  RMAP_DISCOVERY_TTL_SEC,
  sanitizeRmapDiscoveryRow,
  useReticulumDiscoveryMapStore,
} from '@/renderer/stores/reticulumDiscoveryMapStore';
import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';

const nowHeard = () => Math.floor(Date.now() / 1000);

const row = (hash: string, lastHeard: number = nowHeard()): ReticulumRmapDiscoveredWireRow => ({
  discovery_hash: hash,
  transport_id: hash.padEnd(32, '0'),
  discovery_name: hash,
  interface_type: 'RNodeInterface',
  latitude: 1,
  longitude: 2,
  height: 0,
  transport_enabled: false,
  hops: 0,
  stamp_value: 14,
  discovered: 1,
  last_heard: lastHeard,
  heard_count: 1,
  status: 'available',
  has_coordinates: true,
});

describe('reticulumDiscoveryMapStore', () => {
  beforeEach(() => {
    useReticulumDiscoveryMapStore.getState().clear();
  });

  it('mergeRmapDiscoveryRows dedupes by discovery_hash', () => {
    const now = nowHeard();
    const merged = mergeRmapDiscoveryRows([row('a', now - 10)], [row('a', now), row('b', now - 5)]);
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.discovery_hash === 'a')?.last_heard).toBe(now);
  });

  it('clear resets discovered rows', () => {
    useReticulumDiscoveryMapStore.getState().setDiscovered([row('a')]);
    useReticulumDiscoveryMapStore.getState().clear();
    expect(useReticulumDiscoveryMapStore.getState().discovered).toEqual([]);
  });

  it('setDiscovered caps rows to MAX_RMAP_DISCOVERED_ROWS', () => {
    const nowSec = nowHeard();
    const rows = Array.from({ length: MAX_RMAP_DISCOVERED_ROWS + 50 }, (_, i) =>
      row(`h${i}`, nowSec - i),
    );
    useReticulumDiscoveryMapStore.getState().setDiscovered(rows);
    expect(useReticulumDiscoveryMapStore.getState().discovered).toHaveLength(
      MAX_RMAP_DISCOVERED_ROWS,
    );
    expect(useReticulumDiscoveryMapStore.getState().discovered[0]?.discovery_hash).toBe('h0');
  });

  it('normalizeRmapDiscoveryRows evicts rows older than TTL', () => {
    const nowSec = 10_000_000;
    const fresh = row('fresh', nowSec - 100);
    const stale = row('stale', nowSec - RMAP_DISCOVERY_TTL_SEC - 1);
    const normalized = normalizeRmapDiscoveryRows([fresh, stale], nowSec);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.discovery_hash).toBe('fresh');
  });

  it('sanitizeRmapDiscoveryRow rejects invalid rows', () => {
    expect(sanitizeRmapDiscoveryRow(null)).toBeNull();
    expect(sanitizeRmapDiscoveryRow({ discovery_hash: '', transport_id: 'x' })).toBeNull();
    expect(
      sanitizeRmapDiscoveryRow({ discovery_hash: 'a', transport_id: 'b', last_heard: NaN }),
    ).toBeNull();
    const valid = sanitizeRmapDiscoveryRow({
      discovery_hash: 'abc',
      transport_id: 'aa'.repeat(16),
      discovery_name: 'Node',
      interface_type: 'RNodeInterface',
      latitude: 40,
      longitude: -105,
      last_heard: 100,
      has_coordinates: true,
    });
    expect(valid?.discovery_hash).toBe('abc');
  });
});
