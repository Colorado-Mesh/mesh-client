import { describe, expect, it } from 'vitest';

import { traceDataPayloadToResult } from './meshcoreTracePathMultiplex';

describe('meshcoreTracePathMultiplex multibyte', () => {
  it('decodes 2-byte trace payload (10 hash bytes, 6 SNR bytes)', () => {
    const pathHashes = Array.from({ length: 10 }, (_, i) => i + 1);
    const pathSnrs = [40, 41, 42, 43, 44, 45];
    const result = traceDataPayloadToResult({
      pathLen: 10,
      flags: 1,
      pathHashes,
      pathSnrs,
      lastSnr: 11.25,
      tag: 0x1234,
    });
    expect(result.pathLen).toBe(5);
    expect(result.pathLenByte).toBe(10);
    expect(result.pathHashes).toHaveLength(10);
    expect(result.pathSnrs).toHaveLength(5);
    expect(result.lastSnr).toBe(11.25);
  });
});
