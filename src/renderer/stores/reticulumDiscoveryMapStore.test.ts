import { describe, expect, it } from 'vitest';

import {
  mergeRmapDiscoveryRows,
  useReticulumDiscoveryMapStore,
} from '@/renderer/stores/reticulumDiscoveryMapStore';
import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';

const row = (hash: string, lastHeard: number): ReticulumRmapDiscoveredWireRow => ({
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
  it('mergeRmapDiscoveryRows dedupes by discovery_hash', () => {
    const merged = mergeRmapDiscoveryRows([row('a', 1)], [row('a', 99), row('b', 2)]);
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.discovery_hash === 'a')?.last_heard).toBe(99);
  });

  it('clear resets discovered rows', () => {
    useReticulumDiscoveryMapStore.getState().setDiscovered([row('a', 1)]);
    useReticulumDiscoveryMapStore.getState().clear();
    expect(useReticulumDiscoveryMapStore.getState().discovered).toEqual([]);
  });
});
