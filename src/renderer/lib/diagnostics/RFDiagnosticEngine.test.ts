import { beforeEach, describe, expect, it } from 'vitest';

import type { NodeRecord } from '../../stores/nodeStore';
import {
  detectCuSpike,
  diagnoseConnectedNode,
  diagnoseOtherNode,
  resetCuSpikeCooldown,
} from './RFDiagnosticEngine';

function baseNode(overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    nodeId: 0x1,
    longName: 'N',
    shortName: 'N',
    hwModel: '',
    snr: 0,
    batteryLevel: 0,
    lastHeardAt: Date.now(),
    numPacketsRx: 100,
    numPacketsRxBad: 0,
    numRxDupe: 0,
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
      channelUtilization: 50,
      numPacketsRxBad: 25,
      numPacketsRx: 100,
    });
    const findings = diagnoseConnectedNode(node);
    const conditions = findings.map((f) => f.condition);
    expect(conditions).toContain('900MHz Industrial Interference');
    expect(conditions).not.toContain('Hidden Terminal Risk');
  });

  it('adds Hidden Terminal in moderate bad band with high CU', () => {
    const node = baseNode({
      channelUtilization: 45,
      numPacketsRxBad: 8,
      numPacketsRx: 100,
    });
    const findings = diagnoseConnectedNode(node);
    expect(findings.some((f) => f.condition === 'Hidden Terminal Risk')).toBe(true);
  });
});

describe('diagnoseOtherNode', () => {
  it('accepts optional CU context for spike', () => {
    resetCuSpikeCooldown();
    const node = baseNode({
      nodeId: 0x2,
      channelUtilization: 60,
      airUtilTx: 10,
    });
    const findings = diagnoseOtherNode(node, {
      cuStats24h: { average: 10, sampleCount: 20, spanMs: 60 * 60 * 1000 },
    });
    expect(findings).not.toBeNull();
    expect(findings!.some((f) => f.condition === 'Channel Utilization Spike')).toBe(true);
  });
});
