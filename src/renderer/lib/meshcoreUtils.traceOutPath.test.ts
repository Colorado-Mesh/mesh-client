import { describe, expect, it } from 'vitest';

import { meshcoreTraceResultToOutPathBytes } from './meshcoreUtils';

describe('meshcoreTraceResultToOutPathBytes', () => {
  it('builds multi-byte path from trace hashes', () => {
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xab;
    const bytes = meshcoreTraceResultToOutPathBytes(3, [0x11, 0x22, 0x33], pubKey);
    expect(Array.from(bytes)).toEqual([0x11, 0x22, 0x33]);
  });
});
