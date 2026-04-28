import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import {
  detectBadRoute,
  detectHopGoblin,
  detectNoisyNode,
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
    expect(detectHopGoblin(node, home, false, 1, 0, 2)).toBeNull();
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
    expect(detectHopGoblin(node, home, false, 1, 0, 2)).toBeNull();
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
    const a = detectHopGoblin(node, home, false, 1, 0, 2);
    expect(a).not.toBeNull();
    expect(a!.severity).toBe('error');
    expect(a!.confidence).toBe('proven');
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
});
