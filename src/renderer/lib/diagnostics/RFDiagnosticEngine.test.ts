import { beforeEach, describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import {
  detectCuSpike,
  diagnoseConnectedNode,
  diagnoseOtherNode,
  resetCuSpikeCooldown,
} from './RFDiagnosticEngine';

function baseNode(overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: 0x1,
    long_name: 'N',
    short_name: 'N',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    num_packets_rx: 100,
    num_packets_rx_bad: 0,
    num_rx_dupe: 0,
    ...overrides,
  };
}

describe('detectCuSpike', () => {
  beforeEach(() => {
    resetCuSpikeCooldown();
  });

  it('returns null when sample count below gate', () => {
    expect(
      detectCuSpike(50, { average: 10, sampleCount: 5, spanMs: 60 * 60 * 1000 }, 1),
    ).toBeNull();
  });

  it('returns null when span below gate', () => {
    expect(
      detectCuSpike(50, { average: 10, sampleCount: 20, spanMs: 10 * 60 * 1000 }, 1),
    ).toBeNull();
  });

  it('returns null when current not over 2x average', () => {
    expect(
      detectCuSpike(15, { average: 10, sampleCount: 20, spanMs: 60 * 60 * 1000 }, 1),
    ).toBeNull();
  });

  it('returns finding when gates pass', () => {
    const f = detectCuSpike(50, { average: 10, sampleCount: 20, spanMs: 60 * 60 * 1000 }, 1);
    expect(f).not.toBeNull();
    expect(f!.condition).toBe('Channel Utilization Spike');
  });
});

describe('diagnoseConnectedNode Hidden Terminal', () => {
  it('does not add Hidden Terminal when industrial interference present', () => {
    const node = baseNode({
      channel_utilization: 50,
      num_packets_rx_bad: 25,
      num_packets_rx: 100,
    });
    const findings = diagnoseConnectedNode(node);
    const conditions = findings.map((f) => f.condition);
    expect(conditions).toContain('900MHz Industrial Interference');
    expect(conditions).not.toContain('Hidden Terminal Risk');
  });

  it('adds Hidden Terminal in moderate bad band with high CU', () => {
    const node = baseNode({
      channel_utilization: 45,
      num_packets_rx_bad: 8,
      num_packets_rx: 100,
    });
    const findings = diagnoseConnectedNode(node);
    expect(findings.some((f) => f.condition === 'Hidden Terminal Risk')).toBe(true);
  });

  it('does not flag Non-LoRa RFI when num_packets_rx_bad is absent', () => {
    const node = baseNode({
      channel_utilization: 50,
      num_packets_rx: 100,
      num_packets_rx_bad: undefined,
    });
    const findings = diagnoseConnectedNode(node);
    expect(findings.some((f) => f.condition === 'Non-LoRa Noise / RFI')).toBe(false);
  });
});

describe('diagnoseOtherNode', () => {
  it('accepts optional CU context for spike', () => {
    resetCuSpikeCooldown();
    const node = baseNode({
      node_id: 0x2,
      channel_utilization: 60,
      air_util_tx: 10,
    });
    const findings = diagnoseOtherNode(node, {
      cuStats24h: { average: 10, sampleCount: 20, spanMs: 60 * 60 * 1000 },
    });
    expect(findings).not.toBeNull();
    expect(findings!.some((f) => f.condition === 'Channel Utilization Spike')).toBe(true);
  });

  it('returns null immediately when hasRfStats is false', () => {
    const node = baseNode({ channel_utilization: 80, air_util_tx: 1 });
    expect(diagnoseOtherNode(node, { capabilities: { hasRfStats: false } as never })).toBeNull();
  });
});

describe('diagnoseConnectedNode', () => {
  it('returns [] immediately when hasRfStats is false', () => {
    const node = baseNode({ channel_utilization: 80, num_packets_rx_bad: 30, num_packets_rx: 100 });
    expect(
      diagnoseConnectedNode(node, { capabilities: { hasRfStats: false } as never }),
    ).toHaveLength(0);
  });
});

describe('detectCuSpike cooldown', () => {
  beforeEach(() => {
    resetCuSpikeCooldown();
  });

  it('suppresses repeat spike for the same nodeId within cooldown window', () => {
    const stats = { average: 10, sampleCount: 20, spanMs: 60 * 60 * 1000 };
    const first = detectCuSpike(50, stats, 42);
    expect(first).not.toBeNull();
    const second = detectCuSpike(50, stats, 42);
    expect(second).toBeNull();
  });

  it('does not suppress spike for a different nodeId', () => {
    const stats = { average: 10, sampleCount: 20, spanMs: 60 * 60 * 1000 };
    detectCuSpike(50, stats, 42);
    const other = detectCuSpike(50, stats, 99);
    expect(other).not.toBeNull();
  });

  it('does not suppress when nodeId is undefined (anonymous path)', () => {
    const stats = { average: 10, sampleCount: 20, spanMs: 60 * 60 * 1000 };
    const first = detectCuSpike(50, stats, undefined);
    expect(first).not.toBeNull();
    const second = detectCuSpike(50, stats, undefined);
    expect(second).not.toBeNull();
  });
});

describe('diagnoseConnectedNode — MeshCore stats', () => {
  it('flags Elevated Noise Floor when noiseFloor > -95 dBm', () => {
    const node = baseNode({
      meshcore_local_stats: {
        batteryMilliVolts: 0,
        uptimeSecs: 0,
        queueLen: 0,
        noiseFloor: -90,
        lastRssi: 0,
        lastSnr: 0,
        txAirSecs: 0,
        rxAirSecs: 0,
        recv: 0,
        sent: 0,
        nSentFlood: 0,
        nSentDirect: 0,
        nRecvFlood: 0,
        nRecvDirect: 0,
      },
    });
    const findings = diagnoseConnectedNode(node);
    expect(findings.some((f) => f.condition === 'Elevated Noise Floor')).toBe(true);
  });

  it('does not flag Elevated Noise Floor when noiseFloor <= -95 dBm', () => {
    const node = baseNode({
      meshcore_local_stats: {
        batteryMilliVolts: 0,
        uptimeSecs: 0,
        queueLen: 0,
        noiseFloor: -100,
        lastRssi: 0,
        lastSnr: 0,
        txAirSecs: 0,
        rxAirSecs: 0,
        recv: 0,
        sent: 0,
        nSentFlood: 0,
        nSentDirect: 0,
        nRecvFlood: 0,
        nRecvDirect: 0,
      },
    });
    const findings = diagnoseConnectedNode(node);
    expect(findings.some((f) => f.condition === 'Elevated Noise Floor')).toBe(false);
  });

  it('flags Excessive Flooding when >90% flood and totalSent >= 20', () => {
    const node = baseNode({
      meshcore_local_stats: {
        batteryMilliVolts: 0,
        uptimeSecs: 0,
        queueLen: 0,
        noiseFloor: -110,
        lastRssi: 0,
        lastSnr: 0,
        txAirSecs: 0,
        rxAirSecs: 0,
        recv: 0,
        sent: 0,
        nSentFlood: 19,
        nSentDirect: 1,
        nRecvFlood: 0,
        nRecvDirect: 0,
      },
    });
    const findings = diagnoseConnectedNode(node);
    expect(findings.some((f) => f.condition === 'Excessive Flooding')).toBe(true);
  });

  it('does not flag Excessive Flooding when totalSent < 20', () => {
    const node = baseNode({
      meshcore_local_stats: {
        batteryMilliVolts: 0,
        uptimeSecs: 0,
        queueLen: 0,
        noiseFloor: -110,
        lastRssi: 0,
        lastSnr: 0,
        txAirSecs: 0,
        rxAirSecs: 0,
        recv: 0,
        sent: 0,
        nSentFlood: 10,
        nSentDirect: 0,
        nRecvFlood: 0,
        nRecvDirect: 0,
      },
    });
    const findings = diagnoseConnectedNode(node);
    expect(findings.some((f) => f.condition === 'Excessive Flooding')).toBe(false);
  });
});
