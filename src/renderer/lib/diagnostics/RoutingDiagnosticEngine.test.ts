import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import {
  detectBadRoute,
  detectHopGoblin,
  detectImpossibleHop,
  detectNoisyNode,
  detectPathInstability,
  detectWeakLinkOnPath,
  type NoiseStats,
  NOISY_PORTNUMS,
} from './RoutingDiagnosticEngine';

function baseNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 0xabc,
    long_name: 'N',
    short_name: 'N',
    hw_model: '',
    snr: 6,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    hops_away: 5,
    ...overrides,
  };
}

describe('detectHopGoblin', () => {
  it('returns null when no GPS — SNR-only heuristic removed', () => {
    const node = baseNode({ snr: 6, hops_away: 5, latitude: null, longitude: null });
    const home = baseNode({ node_id: 1, latitude: null, longitude: null });
    expect(detectHopGoblin(node, home, 1, 0, 2)).toBeNull();
  });

  it('returns null when coords exist but node not critically close — no SNR branch', () => {
    const node = baseNode({
      snr: 6,
      hops_away: 5,
      latitude: 37.5,
      longitude: -122.5,
    });
    const home = baseNode({
      node_id: 1,
      latitude: 37.0,
      longitude: -122.0,
    });
    expect(detectHopGoblin(node, home, 1, 0, 2)).toBeNull();
  });

  it('returns null for MQTT-only node even when very close with many hops', () => {
    const node = baseNode({
      hops_away: 5,
      latitude: 37.0,
      longitude: -122.0,
      heard_via_mqtt_only: true,
    });
    const home = baseNode({
      node_id: 1,
      latitude: 37.001,
      longitude: -122.001,
    });
    expect(detectHopGoblin(node, home, 1, 0, 2)).toBeNull();
  });

  it('returns error + proven when very close with many hops', () => {
    const node = baseNode({
      snr: 6,
      hops_away: 5,
      latitude: 37.0,
      longitude: -122.0,
    });
    const home = baseNode({
      node_id: 1,
      latitude: 37.001,
      longitude: -122.001,
    });
    const a = detectHopGoblin(node, home, 1, 0, 2);
    expect(a).not.toBeNull();
    expect(a!.severity).toBe('error');
    expect(a!.confidence).toBe('proven');
  });
});

describe('detectImpossibleHop', () => {
  const home = baseNode({
    node_id: 1,
    latitude: 39.7392,
    longitude: -104.9903,
  });

  it('returns null for MQTT-only node with 0 hops far away', () => {
    const node = baseNode({
      hops_away: 0,
      latitude: 40.7608,
      longitude: -111.891,
      heard_via_mqtt_only: true,
    });
    expect(detectImpossibleHop(node, home)).toBeNull();
  });

  it('fires for RF node with 0 hops far away', () => {
    const node = baseNode({
      hops_away: 0,
      latitude: 40.7608,
      longitude: -111.891,
      heard_via_mqtt_only: false,
    });
    const a = detectImpossibleHop(node, home);
    expect(a).not.toBeNull();
    expect(a!.type).toBe('impossible_hop');
    expect(a!.severity).toBe('error');
  });
});

describe('detectBadRoute', () => {
  it('flags high duplication without requiring SNR', () => {
    const node = baseNode({ node_id: 0x1, hops_away: 2, snr: 0 });
    const a = detectBadRoute(node, { total: 100, duplicates: 60 }, null, false, 1, 0, 2);
    expect(a).not.toBeNull();
    expect(a!.type).toBe('bad_route');
    expect(a!.severity).toBe('error');
    expect(a!.description).toContain('duplication');
    expect(a!.description).not.toContain('strong signal');
  });

  it('close-in many-hops warning uses hopsThreshold+2 not fixed 4', () => {
    const node = baseNode({
      node_id: 0x2,
      hops_away: 5,
      latitude: 37.0,
      longitude: -122.0,
    });
    const home = baseNode({
      node_id: 1,
      latitude: 37.001,
      longitude: -122.001,
    });
    // hopsThreshold 2 => maxHopsCloseIn 4 => 5 hops triggers warning
    const w = detectBadRoute(node, undefined, home, false, 1, 0, 2);
    expect(w).not.toBeNull();
    expect(w!.severity).toBe('warning');
    expect(w!.description).toContain('hops');
    // hopsThreshold 4 => maxHopsCloseIn 6 => 5 hops does not trigger same branch
    const w2 = detectBadRoute(node, undefined, home, false, 1, 0, 4);
    expect(w2).toBeNull();
  });
});

describe('detectNoisyNode', () => {
  const HOUR_MS = 3_600_000;

  function makeStats(counts: Record<number, number>): NoiseStats {
    return { nodeId: 1, counts, windowMs: HOUR_MS };
  }

  it('returns null for null stats', () => {
    expect(detectNoisyNode(null)).toBeNull();
  });

  it('returns null when counts are empty', () => {
    expect(detectNoisyNode(makeStats({}))).toBeNull();
  });

  it('POSITION_APP (portnum 3) warns at 4/hr', () => {
    const result = detectNoisyNode(makeStats({ [NOISY_PORTNUMS.POSITION_APP]: 4 }));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('warning');
    expect(result!.description).toContain('Position');
  });

  it('POSITION_APP (portnum 3) errors at 10/hr', () => {
    const result = detectNoisyNode(makeStats({ [NOISY_PORTNUMS.POSITION_APP]: 10 }));
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
  });

  it('POSITION_APP portnum is 3 and REMOTE_HARDWARE_APP portnum is 2', () => {
    expect(NOISY_PORTNUMS.POSITION_APP).toBe(3);
    expect(NOISY_PORTNUMS.REMOTE_HARDWARE_APP).toBe(2);
  });

  it('returns null below warning threshold', () => {
    // 3 position packets in 1 hour is below the 4/hr warn threshold
    expect(detectNoisyNode(makeStats({ [NOISY_PORTNUMS.POSITION_APP]: 3 }))).toBeNull();
  });

  it('NEIGHBOR_INFO_APP (portnum 71) warns at 1/hr and errors at 2/hr', () => {
    const warn = detectNoisyNode(makeStats({ [NOISY_PORTNUMS.NEIGHBOR_INFO_APP]: 1 }));
    expect(warn).not.toBeNull();
    expect(warn!.severity).toBe('warning');

    const error = detectNoisyNode(makeStats({ [NOISY_PORTNUMS.NEIGHBOR_INFO_APP]: 2 }));
    expect(error).not.toBeNull();
    expect(error!.severity).toBe('error');
  });

  it('MeshCore DiscoveryFlood (1001) warns at 3/hr and errors at 10/hr', () => {
    const warn = detectNoisyNode(makeStats({ 1001: 3 }));
    expect(warn).not.toBeNull();
    expect(warn!.severity).toBe('warning');
    expect(warn!.description).toContain('DiscoveryFlood');

    const error = detectNoisyNode(makeStats({ 1001: 10 }));
    expect(error).not.toBeNull();
    expect(error!.severity).toBe('error');
  });

  it('MeshCore RoomAdvert (1002) warns at 4/hr and errors at 10/hr', () => {
    const warn = detectNoisyNode(makeStats({ 1002: 4 }));
    expect(warn).not.toBeNull();
    expect(warn!.severity).toBe('warning');
    expect(warn!.description).toContain('RoomAdvert');

    const error = detectNoisyNode(makeStats({ 1002: 10 }));
    expect(error).not.toBeNull();
    expect(error!.severity).toBe('error');
  });
});

describe('detectWeakLinkOnPath', () => {
  it('returns null when fewer than 2 hops', () => {
    expect(detectWeakLinkOnPath(1, [])).toBeNull();
    expect(detectWeakLinkOnPath(1, [-10])).toBeNull();
  });

  it('returns null when all SNRs are above threshold', () => {
    expect(detectWeakLinkOnPath(1, [2, 5, 8])).toBeNull();
  });

  it('flags weak_link when min SNR is below -5 dB', () => {
    const result = detectWeakLinkOnPath(1, [5, -8, 3]);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('weak_link');
    expect(result!.severity).toBe('warning');
    expect(result!.confidence).toBe('proven');
  });

  it('identifies the correct hop index in the description', () => {
    // Hop 2 (index 1) is the weak one at -10 dB
    const result = detectWeakLinkOnPath(1, [5, -10, 3]);
    expect(result!.description).toContain('hop 2');
    expect(result!.description).toContain('-10.0 dB');
  });

  it('flags the first hop when it is the weakest', () => {
    const result = detectWeakLinkOnPath(1, [-15, -2, 0]);
    expect(result!.description).toContain('hop 1');
  });
});

describe('detectPathInstability', () => {
  const now = Date.now();

  it('returns null when 3 or fewer recent events', () => {
    const timestamps = [now - 1000, now - 2000, now - 3000];
    expect(detectPathInstability(1, timestamps)).toBeNull();
  });

  it('returns route_flapping when more than 3 events in 10 min', () => {
    const timestamps = [now - 1000, now - 2000, now - 3000, now - 4000];
    const result = detectPathInstability(1, timestamps);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('route_flapping');
    expect(result!.severity).toBe('warning');
  });

  it('ignores events older than 10 minutes', () => {
    const tenMinAgo = now - 10 * 60 * 1000;
    const timestamps = [tenMinAgo - 5000, tenMinAgo - 4000, tenMinAgo - 3000, now - 1000];
    // Only 1 event in the window — should not flag
    expect(detectPathInstability(1, timestamps)).toBeNull();
  });
});
