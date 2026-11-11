import { describe, expect, it } from 'vitest';

import {
  meshcoreFirmwareSupportsMultibytePathHash,
  meshcorePackPathLenByte,
  meshcorePathHashModeFromSize,
  meshcorePathHashSizeFromMode,
  meshcorePathHashSizeFromTraceFlags,
  meshcorePubkeyPathPrefix,
  meshcoreResolvePathSenderFromBytes,
  meshcoreSplitPathHashSegments,
  meshcoreTraceDataHashLayout,
  meshcoreUnpackPathLenByte,
} from './meshcorePathHash';

describe('meshcorePathHash', () => {
  it('maps mode to hash size bytes', () => {
    expect(meshcorePathHashSizeFromMode(0)).toBe(1);
    expect(meshcorePathHashSizeFromMode(1)).toBe(2);
    expect(meshcorePathHashSizeFromMode(2)).toBe(3);
    expect(meshcorePathHashModeFromSize(2)).toBe(1);
  });

  it('packs and unpacks path_length byte', () => {
    const packed = meshcorePackPathLenByte(5, 2);
    expect(packed).toBe(0x45);
    expect(meshcoreUnpackPathLenByte(packed)).toEqual({
      hopCount: 5,
      hashSizeBytes: 2,
      packed: 0x45,
    });
  });

  it('rejects hop counts above mode limit', () => {
    expect(() => meshcorePackPathLenByte(33, 2)).toThrow(/exceeds max 32/);
  });

  it('splits multibyte path segments', () => {
    const segs = meshcoreSplitPathHashSegments([0x01, 0x02, 0x03, 0x04], 2);
    expect(segs).toHaveLength(2);
    expect(Array.from(segs.at(0)!)).toEqual([0x01, 0x02]);
    expect(Array.from(segs.at(1)!)).toEqual([0x03, 0x04]);
  });

  it('derives trace layout from pathLen byte and flags', () => {
    const layout = meshcoreTraceDataHashLayout(10, 1);
    expect(layout).toEqual({
      hopCount: 5,
      hashSizeBytes: 2,
      hashByteLength: 10,
      snrByteLength: 6,
    });
    expect(meshcorePathHashSizeFromTraceFlags(1)).toBe(2);
  });

  it('reads trace entry width as 1 << (flags & 3): 1, 2, 4 or 8 bytes', () => {
    // Firmware Mesh::onRecvPacket; not the 1/2/3-byte path hash sizes.
    expect([0, 1, 2, 3].map((flags) => meshcorePathHashSizeFromTraceFlags(flags))).toEqual([
      1, 2, 4, 8,
    ]);
    // A full-key ping retry is one 8-byte entry: one hop, one SNR plus the final SNR.
    expect(meshcoreTraceDataHashLayout(8, 3)).toEqual({
      hopCount: 1,
      hashSizeBytes: 8,
      hashByteLength: 8,
      snrByteLength: 2,
    });
    expect(meshcoreTraceDataHashLayout(8, 2)).toEqual({
      hopCount: 2,
      hashSizeBytes: 4,
      hashByteLength: 8,
      snrByteLength: 3,
    });
  });

  it('splits an 8-byte trace entry as one segment', () => {
    const segs = meshcoreSplitPathHashSegments([1, 2, 3, 4, 5, 6, 7, 8], 8);
    expect(segs).toHaveLength(1);
    expect(Array.from(segs.at(0)!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('resolves 2-byte path sender from pubkey prefix', () => {
    const pubKey = Uint8Array.from({ length: 32 }, (_, i) => i);
    const nodeId = 42;
    const candidates = [{ node_id: nodeId, last_heard: 1000 }];
    const pubKeyMap = new Map([[nodeId, pubKey]]);
    const pathBytes = [0x00, 0x01];
    expect(meshcoreResolvePathSenderFromBytes(pathBytes, 2, candidates, pubKeyMap)).toBe(nodeId);
  });

  it('extracts pubkey path prefix', () => {
    const pubKey = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]);
    expect(Array.from(meshcorePubkeyPathPrefix(pubKey, 2))).toEqual([0xaa, 0xbb]);
  });

  it('detects firmware v1.14+ for multibyte paths', () => {
    expect(meshcoreFirmwareSupportsMultibytePathHash('1.14.0')).toBe(true);
    expect(meshcoreFirmwareSupportsMultibytePathHash('1.13.9')).toBe(false);
    expect(meshcoreFirmwareSupportsMultibytePathHash(undefined)).toBe(false);
  });
});
