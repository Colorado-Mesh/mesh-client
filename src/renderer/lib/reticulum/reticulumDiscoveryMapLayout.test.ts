import { describe, expect, it } from 'vitest';

import {
  haversineDistanceMeters,
  joinRmapDiscoveryWithPeers,
  matchesRmapInterfaceFilter,
  resolveRmapPeerDetailHash,
  rmapLoRaParamsMatch,
} from '@/renderer/lib/reticulum/reticulumDiscoveryMapLayout';
import type {
  ReticulumPeerWireRow,
  ReticulumRmapDiscoveredWireRow,
} from '@/shared/reticulum-types';

const nowHeard = () => Math.floor(Date.now() / 1000);

function sampleRow(
  partial: Partial<ReticulumRmapDiscoveredWireRow> = {},
): ReticulumRmapDiscoveredWireRow {
  return {
    discovery_hash: 'abc',
    transport_id: 'aa'.repeat(16),
    discovery_name: 'Node A',
    interface_type: 'RNodeInterface',
    latitude: 40.0,
    longitude: -105.0,
    height: 0,
    transport_enabled: true,
    hops: 1,
    stamp_value: 14,
    discovered: 1,
    last_heard: nowHeard(),
    heard_count: 1,
    status: 'available',
    has_coordinates: true,
    ...partial,
  };
}

describe('reticulumDiscoveryMapLayout', () => {
  it('joinRmapDiscoveryWithPeers marks reachable transport ids', () => {
    const discovered = [sampleRow({ transport_id: 'deadbeef'.repeat(4) })];
    const peers: ReticulumPeerWireRow[] = [{ destination_hash: 'deadbeef'.repeat(4), hops: 1 }];
    const layout = joinRmapDiscoveryWithPeers(discovered, peers);
    expect(layout.markers).toHaveLength(1);
    expect(layout.markers[0]?.reachable).toBe(true);
    expect(layout.markers[0]?.peerDetailHash).toBe('deadbeef'.repeat(4));
  });

  it('resolveRmapPeerDetailHash matches via_hash when destination differs', () => {
    const transportId = 'cafebabe'.repeat(4);
    const peers: ReticulumPeerWireRow[] = [
      { destination_hash: 'deadbeef'.repeat(4), via_hash: transportId, hops: 2 },
    ];
    expect(resolveRmapPeerDetailHash(transportId, peers)).toBe(transportId);
  });

  it('joinRmapDiscoveryWithPeers leaves peerDetailHash null for heard-only rows', () => {
    const discovered = [sampleRow({ transport_id: 'unknown'.repeat(4) })];
    const layout = joinRmapDiscoveryWithPeers(discovered, []);
    expect(layout.markers[0]?.peerDetailHash).toBeNull();
  });

  it('joinRmapDiscoveryWithPeers splits list-only rows without coords', () => {
    const discovered = [
      sampleRow({ discovery_hash: 'with', has_coordinates: true }),
      sampleRow({
        discovery_hash: 'without',
        latitude: 0,
        longitude: 0,
        has_coordinates: false,
      }),
    ];
    const layout = joinRmapDiscoveryWithPeers(discovered, []);
    expect(layout.markers).toHaveLength(1);
    expect(layout.listOnly).toHaveLength(1);
  });

  it('matchesRmapInterfaceFilter by interface family', () => {
    expect(matchesRmapInterfaceFilter({ interface_type: 'RNodeInterface' }, 'rnode')).toBe(true);
    expect(matchesRmapInterfaceFilter({ interface_type: 'I2PInterface' }, 'i2p')).toBe(true);
    expect(matchesRmapInterfaceFilter({ interface_type: 'RNodeInterface' }, 'tcp')).toBe(false);
  });

  it('rmapLoRaParamsMatch compares frequency bandwidth and SF', () => {
    const a = sampleRow({
      interface_type: 'RNodeInterface',
      frequency: 869_525_000,
      bandwidth: 125_000,
      spreading_factor: 8,
    });
    const b = sampleRow({
      interface_type: 'RNodeInterface',
      frequency: 869_525_000,
      bandwidth: 125_000,
      spreading_factor: 8,
    });
    const c = sampleRow({
      interface_type: 'RNodeInterface',
      frequency: 915_000_000,
      bandwidth: 125_000,
      spreading_factor: 8,
    });
    expect(rmapLoRaParamsMatch(a, b)).toBe(true);
    expect(rmapLoRaParamsMatch(a, c)).toBe(false);
  });

  it('haversineDistanceMeters is zero for identical points', () => {
    expect(haversineDistanceMeters(40, -105, 40, -105)).toBe(0);
  });
});
