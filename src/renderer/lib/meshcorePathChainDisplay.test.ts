import { describe, expect, it } from 'vitest';

import {
  buildMeshcorePathChainSegments,
  formatMeshcorePathSegmentHex,
} from './meshcorePathChainDisplay';

describe('meshcorePathChainDisplay', () => {
  it('formats single-byte segments as uppercase hex', () => {
    expect(formatMeshcorePathSegmentHex(Uint8Array.from([0x80]))).toBe('80');
    expect(formatMeshcorePathSegmentHex(Uint8Array.from([0x5d]))).toBe('5D');
  });

  it('formats two-byte segments concatenated', () => {
    expect(formatMeshcorePathSegmentHex(Uint8Array.from([0xe9, 0x64]))).toBe('E964');
  });

  it('splits path bytes into hop segments', () => {
    const segments = buildMeshcorePathChainSegments({
      pathBytes: [0x80, 0x5d, 0x07],
      hashSizeBytes: 1,
      getNodeLabel: (id) => `node-${id}`,
    });
    expect(segments.map((s) => s.hex)).toEqual(['80', '5D', '07']);
  });

  it('resolves segment to contact label when pubkey prefix matches', () => {
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xe9;
    pubKey[1] = 0x64;
    const pubKeyByNodeId = new Map<number, Uint8Array>([[42, pubKey]]);
    const segments = buildMeshcorePathChainSegments({
      pathBytes: [0xe9, 0x64],
      hashSizeBytes: 2,
      getNodeLabel: (id) => `Repeater-${id}`,
      pubKeyByNodeId,
      candidates: [{ node_id: 42, last_heard: 1 }],
    });
    expect(segments[0]?.resolvedNodeId).toBe(42);
    expect(segments[0]?.resolvedLabel).toBe('Repeater-42');
  });
});
