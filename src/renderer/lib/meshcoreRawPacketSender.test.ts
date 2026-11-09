import { describe, expect, it } from 'vitest';

import { parseMeshCoreRfPacket } from '../../shared/meshcoreRfPacketParse';
import {
  meshcoreRawPacketLogFromBytesFallback,
  meshcoreRawPacketResolveFromNodeId,
  meshcoreRawPacketResolveFromParsed,
} from './meshcoreRawPacketSender';
import { meshcoreSyntheticPlaceholderPubKeyHex, pubkeyToNodeId } from './meshcoreUtils';
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

/** 32-byte key starting with the given bytes (the rest fixed). */
function keyStartingWith(...prefix: number[]): Uint8Array {
  const key = new Uint8Array(32).fill(0x5a);
  key.set(prefix, 0);
  return key;
}

function prefixHex6(key: Uint8Array): string {
  return Array.from(key.subarray(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * REQ / RESPONSE / TXT_MSG / PATH as MeshCore builds them (`Mesh::createDatagram`): header, path
 * length, path hashes, then dest hash (1 byte), src hash (1 byte), MAC (2), ciphertext (16).
 */
function datagram(opts: {
  payloadType: number;
  route: 'FLOOD' | 'DIRECT';
  dest: number;
  src: number;
  path?: number[];
}): Uint8Array {
  const path = opts.path ?? [];
  const routeBits = opts.route === 'FLOOD' ? 1 : 2;
  return Uint8Array.from([
    (opts.payloadType << 2) | routeBits,
    path.length,
    ...path,
    opts.dest,
    opts.src,
    0x3c,
    0x7e,
    ...Array.from({ length: 16 }, (_, i) => (i * 29 + 7) & 0xff),
  ]);
}

describe('MeshCore DM-type packet sender (1-byte source hash)', () => {
  const self = keyStartingWith(0xab, 0x00, 0x00, 0x00);
  const alex = keyStartingWith(0xa1, 0x00, 0x51, 0x52);
  const golden = keyStartingWith(0xf8, 0xaa, 0x41, 0x42);
  const pikes = keyStartingWith(0xf8, 0xf9, 0x11, 0x22);
  const alexId = pubkeyToNodeId(alex);
  const contacts = new Map<string, number>([
    [prefixHex6(alex), alexId],
    [prefixHex6(golden), pubkeyToNodeId(golden)],
    [prefixHex6(pikes), pubkeyToNodeId(pikes)],
  ]);

  function resolve(raw: Uint8Array, map = contacts, selfKey: Uint8Array | null = self) {
    const parsed = parseMeshCoreRfPacket(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return undefined;
    return meshcoreRawPacketResolveFromParsed(parsed, map, selfKey);
  }

  it.each([
    ['REQ', 0x00],
    ['RESPONSE', 0x01],
    ['TXT_MSG', 0x02],
    ['PATH', 0x08],
  ])(
    'resolves a %s to us from the one contact whose key starts with the source hash',
    (_, type) => {
      const raw = datagram({
        payloadType: type,
        route: 'FLOOD',
        dest: 0xab,
        src: 0xa1,
        path: [0x3a],
      });
      expect(resolve(raw)).toBe(alexId);
    },
  );

  it('resolves direct-routed packets too', () => {
    expect(resolve(datagram({ payloadType: 0x02, route: 'DIRECT', dest: 0xab, src: 0xa1 }))).toBe(
      alexId,
    );
  });

  it('gives no sender for a packet addressed to another node', () => {
    expect(
      resolve(datagram({ payloadType: 0x02, route: 'FLOOD', dest: 0x3c, src: 0xa1 })),
    ).toBeNull();
  });

  it('gives no sender when several contacts share the source hash', () => {
    expect(
      resolve(datagram({ payloadType: 0x02, route: 'FLOOD', dest: 0xab, src: 0xf8 })),
    ).toBeNull();
  });

  it('gives no sender when the source hash is our own key (our echo)', () => {
    const ownByteContact = keyStartingWith(0xab, 0x11, 0x22, 0x33);
    const map = new Map(contacts).set(prefixHex6(ownByteContact), pubkeyToNodeId(ownByteContact));
    for (const m of [contacts, map]) {
      expect(
        resolve(datagram({ payloadType: 0x02, route: 'FLOOD', dest: 0x3c, src: 0xab }), m),
      ).toBeNull();
      expect(
        resolve(datagram({ payloadType: 0x02, route: 'FLOOD', dest: 0xab, src: 0xab }), m),
      ).toBeNull();
    }
  });

  it('gives no sender without our own public key', () => {
    expect(
      resolve(
        datagram({ payloadType: 0x02, route: 'FLOOD', dest: 0xab, src: 0xa1 }),
        contacts,
        null,
      ),
    ).toBeNull();
  });

  it('ignores placeholder keys of MQTT-only contacts', () => {
    const placeholderHex = meshcoreSyntheticPlaceholderPubKeyHex(0x1234);
    const placeholderPrefix = placeholderHex.slice(0, 12);
    const real = keyStartingWith(0x4d, 0x01, 0x02, 0x03);
    const onlyPlaceholder = new Map(contacts).set(placeholderPrefix, 0x1234);
    const both = new Map(onlyPlaceholder).set(prefixHex6(real), pubkeyToNodeId(real));
    const raw = datagram({ payloadType: 0x02, route: 'FLOOD', dest: 0xab, src: 0x4d });
    expect(resolve(raw, onlyPlaceholder)).toBeNull();
    expect(resolve(raw, both)).toBe(pubkeyToNodeId(real));
  });

  it('applies the same rule when the full parse fails (byte fallback)', () => {
    const raw = datagram({
      payloadType: 0x02,
      route: 'FLOOD',
      dest: 0xab,
      src: 0xa1,
      path: [0x3a],
    });
    expect(meshcoreRawPacketLogFromBytesFallback(raw, contacts, self)?.fromNodeId).toBe(alexId);
    const elsewhere = datagram({ payloadType: 0x02, route: 'FLOOD', dest: 0x3c, src: 0xa1 });
    expect(meshcoreRawPacketLogFromBytesFallback(elsewhere, contacts, self)?.fromNodeId).toBeNull();
  });
});
