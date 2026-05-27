import { describe, expect, it } from 'vitest';

import type { NodeRecord } from '../../stores/nodeStore';
import { snrMeaningfulForNodeDiagnostics } from './snrMeaningfulForNodeDiagnostics';

function node(partial: Partial<NodeRecord>): NodeRecord {
  return {
    nodeId: 1,
    longName: '',
    shortName: '',
    hwModel: '',
    snr: 5,
    batteryLevel: 0,
    lastHeardAt: Date.now(),
    ...partial,
  };
}

describe('snrMeaningfulForNodeDiagnostics', () => {
  it('false when MQTT-only', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ heardViaMqttOnly: true, hopsAway: 0 }))).toBe(
      false,
    );
  });

  it('false when heard_via_mqtt (hybrid / stale SNR)', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ heardViaMqtt: true, hopsAway: 0 }))).toBe(
      false,
    );
  });

  it('false when source mqtt', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ source: 'mqtt', hopsAway: 0 }))).toBe(false);
  });

  it('false when hops_away > 0', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ hopsAway: 1 }))).toBe(false);
  });

  it('false when hops_away undefined — unknown, not proven direct', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({}))).toBe(false);
  });

  it('true when direct RF only', () => {
    expect(
      snrMeaningfulForNodeDiagnostics(
        node({ hopsAway: 0, source: 'rf', heardViaMqtt: false, heardViaMqttOnly: false }),
      ),
    ).toBe(true);
  });

  it('true when hops_away 0 and no MQTT flags', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ hopsAway: 0 }))).toBe(true);
  });
});
