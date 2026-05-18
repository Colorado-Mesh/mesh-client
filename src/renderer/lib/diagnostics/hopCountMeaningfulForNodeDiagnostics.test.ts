import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import { hopCountMeaningfulForNodeDiagnostics } from './hopCountMeaningfulForNodeDiagnostics';

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
  };
}

describe('hopCountMeaningfulForNodeDiagnostics', () => {
  it('false when MQTT-only', () => {
    expect(hopCountMeaningfulForNodeDiagnostics(node({ heard_via_mqtt_only: true }))).toBe(false);
  });

  it('true for RF-only node', () => {
    expect(
      hopCountMeaningfulForNodeDiagnostics(
        node({ heard_via_mqtt_only: false, heard_via_mqtt: false }),
      ),
    ).toBe(true);
  });

  it('true for hybrid (heard_via_mqtt but not mqtt_only)', () => {
    expect(
      hopCountMeaningfulForNodeDiagnostics(
        node({ heard_via_mqtt: true, heard_via_mqtt_only: false }),
      ),
    ).toBe(true);
  });
});
