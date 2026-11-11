import { describe, expect, it } from 'vitest';

import {
  getMergedNodesForForeignLoraDiagnostics,
  getMeshcoreDiagnosticsSelfNodeId,
  setMeshcoreDiagnosticsNodes,
} from './diagnosticsNodesRef';
import type { MeshNode } from './types';

describe('diagnosticsNodesRef', () => {
  it('merges MeshCore nodes into Meshtastic map for foreign LoRa', () => {
    const mcNode: MeshNode = {
      node_id: 0xabcd,
      long_name: 'MC Node',
      short_name: 'MC',
      hw_model: 'Repeater',
      battery: 100,
      snr: 5,
      last_heard: Date.now(),
      latitude: 39.0,
      longitude: -105.0,
    };
    const mtNode: MeshNode = {
      node_id: 0x1234,
      long_name: 'MT Node',
      short_name: 'MT',
      hw_model: 'T-Beam',
      battery: 80,
      snr: 3,
      last_heard: Date.now(),
      latitude: 40.0,
      longitude: -104.0,
    };
    const mcNodes = new Map([[0xabcd, mcNode]]);
    const mtNodes = new Map([[0x1234, mtNode]]);

    setMeshcoreDiagnosticsNodes(mcNodes, 0xabcd);
    const merged = getMergedNodesForForeignLoraDiagnostics(mtNodes);

    expect(merged.size).toBe(2);
    expect(merged.get(0x1234)!.long_name).toBe('MT Node');
    expect(merged.get(0xabcd)!.long_name).toBe('MC Node');
    expect(getMeshcoreDiagnosticsSelfNodeId()).toBe(0xabcd);
  });

  it('replaces snapshot when called again', () => {
    setMeshcoreDiagnosticsNodes(
      new Map([
        [
          1,
          {
            node_id: 1,
            long_name: 'a',
            short_name: '',
            hw_model: '',
            battery: 0,
            snr: 0,
            last_heard: 0,
            latitude: null,
            longitude: null,
          },
        ],
      ]),
      1,
    );
    setMeshcoreDiagnosticsNodes(
      new Map([
        [
          2,
          {
            node_id: 2,
            long_name: 'b',
            short_name: '',
            hw_model: '',
            battery: 0,
            snr: 0,
            last_heard: 0,
            latitude: null,
            longitude: null,
          },
        ],
      ]),
      2,
    );
    const merged = getMergedNodesForForeignLoraDiagnostics(new Map());
    expect(merged.size).toBe(1);
    expect(merged.get(2)!.long_name).toBe('b');
    expect(getMeshcoreDiagnosticsSelfNodeId()).toBe(2);
  });
});
