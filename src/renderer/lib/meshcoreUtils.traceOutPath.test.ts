import { describe, expect, it } from 'vitest';

import { meshcoreTraceResultToOutPathBytes } from './meshcoreUtils';

describe('meshcoreTraceResultToOutPathBytes', () => {
  it('builds multi-byte path from trace hashes (1-byte legacy)', () => {
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xab;
    const bytes = meshcoreTraceResultToOutPathBytes(3, [0x11, 0x22, 0x33], pubKey, 0);
    expect(Array.from(bytes)).toEqual([0x11, 0x22, 0x33]);
  });

  it('builds 2-byte path from trace hashes', () => {
    const pubKey = new Uint8Array(32);
    const pathHashes = Array.from({ length: 10 }, (_, i) => i + 1);
    const bytes = meshcoreTraceResultToOutPathBytes(10, pathHashes, pubKey, 1);
    expect(Array.from(bytes)).toEqual(pathHashes);
  });
});
