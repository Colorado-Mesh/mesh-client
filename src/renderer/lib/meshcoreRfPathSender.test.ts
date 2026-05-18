import { describe, expect, it } from 'vitest';

import { meshcoreNodeHash } from '../../shared/meshcoreNodeHash';
import {
  meshcoreRfNodeHashCandidates,
  meshcoreRfResolvePathSender,
} from './meshcoreRawPacketSender';
import type { MeshNode } from './types';

function minimalNode(nodeId: number, lastHeard: number, longName?: string): MeshNode {
  return {
    node_id: nodeId,
    long_name: longName ?? 'Test',
    short_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: lastHeard,
    latitude: null,
    longitude: null,
  };
}

describe('meshcoreRfResolvePathSender', () => {
  it('resolves originator from path hash bytes (prefers freshest contact)', () => {
    const originId = 0xf6000000;
    const staleId = 0x00f60000;
    const hash = meshcoreNodeHash(originId);
    expect(meshcoreNodeHash(staleId)).toBe(hash);
    const nodes = new Map([
      [originId, minimalNode(originId, 9999, 'NV0N 01')],
      [staleId, minimalNode(staleId, 1, 'Stale')],
    ]);
    const candidates = meshcoreRfNodeHashCandidates(nodes, 0);
    expect(meshcoreRfResolvePathSender([hash, 0xab, 0xcd], candidates)).toBe(originId);
  });

  it('prefers recently heard nodes when RSSI is very close', () => {
    const staleId = 0xf6000000;
    const freshId = 0x00f60000;
    const hash = meshcoreNodeHash(staleId);
    expect(meshcoreNodeHash(freshId)).toBe(hash);
    const nodes = new Map([
      [staleId, minimalNode(staleId, 1, 'Stale')],
      [freshId, minimalNode(freshId, 9999, 'Fresh')],
    ]);
    const candidates = meshcoreRfNodeHashCandidates(nodes, 0, { rssi: -50 });
    expect(meshcoreRfResolvePathSender([hash], candidates)).toBe(freshId);
  });
});
