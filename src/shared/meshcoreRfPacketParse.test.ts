import { describe, expect, it } from 'vitest';

import {
  meshCorePacketFingerprintHex,
  meshCoreTransportCodeForRegion,
  parseMeshCoreRfPacket,
} from './meshcoreRfPacketParse';

/** Real RF flood advert (path-prefix decode; in-house parse must succeed). */
const FLOOD_ADVERT_HEX =
  '110649cc80710706ce47b76233ce222c37bdb3bb394a75d08dfdd2d0b30d74ff5003409f10acb5a7c420dc69b3ec2d02fec6c29583702b2c8a482a64c6c8f1d0b16ba19a5ac36261512feda7c10ac08a2248146d9193ab55887227dfae25b2e9f1bfee29726efd2537aefa0692c8046302d2d9b9f944454e2d424c44522d5754562d52452d43453437';

/** FLOOD + GRP_TXT (nibble 5): 2 one-byte path hashes; inner starts with 11 13 37 a7 (BE u32 0x111337a7). */
const FLOOD_GRP_TXT_HEX =
  '15028807111337a709eb7f50a1a94d8ee7e5ded8672cef2660e88c976c9782bf520ae1bf08b564ccd2c1afb5960e211a671a1282587e5836d0e80d46879a9069f08465733f5c79';

function hexToU8(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('parseMeshCoreRfPacket', () => {
  it('parses FLOOD ADVERT sample with hops, fingerprint, and inner ADVERT fields', () => {
    const raw = hexToU8(FLOOD_ADVERT_HEX);
    const p = parseMeshCoreRfPacket(raw);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.routeTypeString).toBe('FLOOD');
    expect(p.payloadTypeString).toBe('ADVERT');
    expect(p.hopCount).toBe(6);
    expect(p.transportCodes).toBeNull();
    expect(p.messageFingerprintHex).toBe(meshCorePacketFingerprintHex(raw));
    expect(p.advert).not.toBeNull();
    expect(p.advert!.publicKey.length).toBe(32);
    expect(p.advert!.name.length).toBeGreaterThan(0);
  });

  it('reads transport codes on TRANSPORT_FLOOD + TRACE layout', () => {
    const buffer = new Uint8Array([0x24, 0x34, 0x12, 0x78, 0x56, 0x02, 0x11, 0x22]);
    const p = parseMeshCoreRfPacket(buffer);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.transportCodes).toEqual([0x1234, 0x5678]);
    expect(p.hopCount).toBe(2);
  });

  it('parses FLOOD + GRP_TXT sample: pathEnd at 4, inner prefix matches meshcore.js PAYLOAD_TYPE_GRP_TXT', () => {
    const raw = hexToU8(FLOOD_GRP_TXT_HEX);
    const p = parseMeshCoreRfPacket(raw);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.routeTypeString).toBe('FLOOD');
    expect(p.payloadTypeString).toBe('GRP_TXT');
    expect(p.payloadTypeNibble).toBe(5);
    expect(p.hopCount).toBe(2);
    expect(p.pathEndOffset).toBe(4);
    expect(p.innerPayload.length).toBe(raw.length - 4);
    expect(p.innerPayload[0]).toBe(0x11);
    expect(p.innerPayload[1]).toBe(0x13);
    expect(p.innerPayload[2]).toBe(0x37);
    expect(p.innerPayload[3]).toBe(0xa7);
    const innerBeU32 =
      ((p.innerPayload[0] << 24) |
        (p.innerPayload[1] << 16) |
        (p.innerPayload[2] << 8) |
        p.innerPayload[3]) >>>
      0;
    expect(innerBeU32).toBe(0x111337a7);
  });
});

describe('meshCoreTransportCodeForRegion', () => {
  it('returns stable uint16 for region + payload', async () => {
    const inner = hexToU8('00'.repeat(16));
    const a = await meshCoreTransportCodeForRegion('#TestRegion', 4, inner);
    const b = await meshCoreTransportCodeForRegion('#TestRegion', 4, inner);
    expect(a).toBe(b);
    expect(a & 0xffff).toBe(a);
  });
});
