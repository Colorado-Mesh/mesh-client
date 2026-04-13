import { describe, expect, it } from 'vitest';

import { meshcoreRawPacketResolveFromNodeId } from './meshcoreRawPacketSender';
import { pubkeyToNodeId } from './meshcoreUtils';
import { MESHCORE_PAYLOAD_TYPE_ADVERT } from './rawPacketLogConstants';

describe('meshcoreRawPacketResolveFromNodeId', () => {
  const nonZeroPubKey = (): Uint8Array => {
    const key32 = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key32[i] = (i * 7 + 1) & 0xff;
    return key32;
  };

  it('uses pubkeyToNodeId(first 32 bytes) for ADVERT payloads', () => {
    const payload = nonZeroPubKey();
    const expected = pubkeyToNodeId(payload);
    expect(expected).not.toBe(0);
    expect(
      meshcoreRawPacketResolveFromNodeId(
        { payload, payload_type: MESHCORE_PAYLOAD_TYPE_ADVERT },
        new Map(),
      ),
    ).toBe(expected);
  });

  it('falls back to 6-byte prefix map when ADVERT pubkey folds to 0', () => {
    const payload = new Uint8Array(32);
    const prefixHex = Array.from(payload.subarray(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const map = new Map<string, number>([[prefixHex, 0xdeadbeef]]);
    expect(pubkeyToNodeId(payload)).toBe(0);
    expect(
      meshcoreRawPacketResolveFromNodeId(
        { payload, payload_type: MESHCORE_PAYLOAD_TYPE_ADVERT },
        map,
      ),
    ).toBe(0xdeadbeef);
  });

  it('uses 6-byte prefix map for non-ADVERT payloads when prefix matches', () => {
    const bytes = new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x02, 0x03]);
    const prefixHex = 'abcdef010203';
    const map = new Map<string, number>([[prefixHex, 0x11223344]]);
    expect(meshcoreRawPacketResolveFromNodeId({ payload: bytes, payload_type: 2 }, map)).toBe(
      0x11223344,
    );
  });

  it('returns null when nothing matches', () => {
    expect(
      meshcoreRawPacketResolveFromNodeId(
        { payload: new Uint8Array([1, 2, 3]), payload_type: 2 },
        new Map(),
      ),
    ).toBeNull();
  });
});
