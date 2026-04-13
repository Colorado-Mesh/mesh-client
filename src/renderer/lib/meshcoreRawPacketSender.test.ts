import { describe, expect, it } from 'vitest';

import { parseMeshCoreRfPacket } from '../../shared/meshcoreRfPacketParse';
import {
  meshcoreRawPacketResolveFromNodeId,
  meshcoreRawPacketResolveFromParsed,
} from './meshcoreRawPacketSender';
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

describe('meshcoreRawPacketResolveFromParsed', () => {
  it('resolves ANON_REQ sender from inner[1:33] sender_pubkey', () => {
    const senderKey = new Uint8Array(32);
    for (let i = 0; i < senderKey.length; i++) senderKey[i] = (i * 11 + 3) & 0xff;

    const raw = new Uint8Array(2 + 1 + senderKey.length + 2 + 1);
    raw[0] = 0x1d; // FLOOD + ANON_REQ nibble
    raw[1] = 0x00; // path length 0, hash size 1
    raw[2] = 0x03; // dest hash
    raw.set(senderKey, 3);
    raw[35] = 0x88; // mac[0]
    raw[36] = 0x71; // mac[1]
    raw[37] = 0x06; // ciphertext[0]

    const parsed = parseMeshCoreRfPacket(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const expected = pubkeyToNodeId(senderKey);
    expect(expected).not.toBe(0);
    const wrongOffsetId = pubkeyToNodeId(parsed.innerPayload.subarray(0, 32));
    expect(wrongOffsetId).not.toBe(expected);
    expect(meshcoreRawPacketResolveFromParsed(parsed, new Map())).toBe(expected);
  });

  it('skips GRP_TXT prefix map lookup from inner[0:6]', () => {
    const raw = new Uint8Array([
      0x15, 0x00, 0x11, 0x13, 0x37, 0xa7, 0x09, 0xeb, 0x7f, 0x50, 0xa1, 0xa9,
    ]);
    const parsed = parseMeshCoreRfPacket(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const prefixHex = Array.from(parsed.innerPayload.subarray(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const map = new Map<string, number>([[prefixHex, 0x11223344]]);
    expect(meshcoreRawPacketResolveFromParsed(parsed, map)).toBeNull();
  });
});
