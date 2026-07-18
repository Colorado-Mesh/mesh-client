import { describe, expect, it } from 'vitest';

import {
  buildMeshcorePathChainSegments,
  buildMeshcorePathResolutionFromNodes,
  formatMeshcorePathSegmentHex,
  meshcoreDisplayRouteFromPathSelection,
  meshcoreOutPathHashSizeBytes,
  meshcorePathBytesEqual,
  meshcoreTraceHopDisplayRows,
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

  it('buildMeshcorePathResolutionFromNodes parses public_key_hex', () => {
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xaa;
    const hex = Array.from(pubKey, (b) => b.toString(16).padStart(2, '0')).join('');
    const nodes = new Map([
      [7, { node_id: 7, last_heard: 100, long_name: 'Relay Seven', public_key_hex: hex }],
    ]);
    const inputs = buildMeshcorePathResolutionFromNodes(nodes);
    expect(inputs.candidates).toEqual([{ node_id: 7, last_heard: 100 }]);
    expect(inputs.pubKeyByNodeId.get(7)?.[0]).toBe(0xaa);
    expect(inputs.getNodeLabel(7)).toBe('Relay Seven');
  });

  it('meshcoreOutPathHashSizeBytes prefers hopCount+1 segments', () => {
    // 3 bytes, UI hops=2 → 3 segments of 1 byte
    expect(meshcoreOutPathHashSizeBytes([1, 2, 3], 2)).toBe(1);
    // 6 bytes, UI hops=2 → 3 segments of 2 bytes
    expect(meshcoreOutPathHashSizeBytes([1, 2, 3, 4, 5, 6], 2)).toBe(2);
    expect(meshcoreOutPathHashSizeBytes([], 0)).toBe(1);
  });

  it('meshcoreDisplayRouteFromPathSelection returns null for empty path', () => {
    expect(meshcoreDisplayRouteFromPathSelection(null)).toBeNull();
    expect(meshcoreDisplayRouteFromPathSelection({ pathBytes: [], hopCount: 0 })).toBeNull();
  });

  it('meshcoreDisplayRouteFromPathSelection derives hash size', () => {
    const route = meshcoreDisplayRouteFromPathSelection({
      pathBytes: [0x11, 0x22, 0x33],
      hopCount: 2,
    });
    expect(route).toEqual({
      pathBytes: [0x11, 0x22, 0x33],
      hopCount: 2,
      hashSizeBytes: 1,
    });
  });

  it('meshcorePathBytesEqual compares byte arrays', () => {
    expect(meshcorePathBytesEqual([1, 2], [1, 2])).toBe(true);
    expect(meshcorePathBytesEqual([1, 2], [1, 3])).toBe(false);
    expect(meshcorePathBytesEqual(undefined, [1])).toBe(false);
  });

  it('meshcoreTraceHopDisplayRows pairs SNRs with segment names and suppresses dest segment', () => {
    // 1-byte hashes resolve via node_id XOR-fold (meshcoreNodeHash), not pubkey.
    const relayId = 0xaa;
    const destId = 0xbb;
    const rows = meshcoreTraceHopDisplayRows({
      pathHashes: [0xaa, 0xbb],
      pathSnrs: [4.5, 3.25],
      hashSizeBytes: 1,
      destNodeId: destId,
      getNodeLabel: (id) => (id === relayId ? 'RelayA' : 'DestB'),
      candidates: [
        { node_id: relayId, last_heard: 1 },
        { node_id: destId, last_heard: 1 },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('RelayA');
    expect(rows[0]?.snr).toBe(4.5);
  });

  it('meshcoreTraceHopDisplayRows keeps all rows when last segment is not dest', () => {
    const rows = meshcoreTraceHopDisplayRows({
      pathHashes: [0x11, 0x22],
      pathSnrs: [1, 2],
      hashSizeBytes: 1,
      destNodeId: 99,
      getNodeLabel: () => 'x',
      candidates: [],
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.hex)).toEqual(['11', '22']);
  });
});
