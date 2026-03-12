import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import { snrMeaningfulForNodeDiagnostics } from './snrMeaningfulForNodeDiagnostics';

function node(partial: Partial<MeshNode>): MeshNode {
  return {
    node_id: 1,
    long_name: '',
    short_name: '',
    hw_model: '',
    snr: 5,
    battery: 0,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    ...partial,
  } as MeshNode;
}

describe('snrMeaningfulForNodeDiagnostics', () => {
  it('false when MQTT-only', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ heard_via_mqtt_only: true, hops_away: 0 }))).toBe(
      false,
    );
  });

  it('false when heard_via_mqtt (hybrid / stale SNR)', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ heard_via_mqtt: true, hops_away: 0 }))).toBe(
      false,
    );
  });

  it('false when source mqtt', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ source: 'mqtt', hops_away: 0 }))).toBe(false);
  });

  it('false when hops_away > 0', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ hops_away: 1 }))).toBe(false);
  });

  it('false when hops_away undefined — unknown, not proven direct', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({}))).toBe(false);
  });

  it('true when direct RF only', () => {
    expect(
      snrMeaningfulForNodeDiagnostics(
        node({ hops_away: 0, source: 'rf', heard_via_mqtt: false, heard_via_mqtt_only: false }),
      ),
    ).toBe(true);
  });

  it('true when hops_away 0 and no MQTT flags', () => {
    expect(snrMeaningfulForNodeDiagnostics(node({ hops_away: 0 }))).toBe(true);
  });
});
