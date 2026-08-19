import { describe, expect, it } from 'vitest';

import { computeMeshtasticChannelHash } from './meshtasticChannelHash';
import { MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES } from './meshtasticDefaultPublicPsk';

const CUSTOM_PSK = new Uint8Array([
  0x1e, 0x2f, 0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x90, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07,
]);

describe('computeMeshtasticChannelHash', () => {
  it('XOR-folds the channel name against the key (firmware Channels::generateHash shape)', () => {
    // Firmware reference vector: XOR-fold of "LongFast" bytes = 0x0a; XOR-fold of the real
    // default channel key (d4f1bb3a20290759f0bcffabcf4e6901) = 0x02; hash = 0x0a ^ 0x02 = 0x08.
    expect(computeMeshtasticChannelHash('LongFast', MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES)).toBe(
      0x08,
    );
  });

  it('is deterministic — same name+PSK always hashes the same', () => {
    const a = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    const b = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    expect(a).toBe(b);
  });

  it('changes when the channel name or PSK changes', () => {
    const base = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    expect(computeMeshtasticChannelHash('OtherName', CUSTOM_PSK)).not.toBe(base);
    expect(computeMeshtasticChannelHash('TGIFMESH', MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES)).not.toBe(
      base,
    );
  });

  it('always returns a single byte (0-255)', () => {
    const h = computeMeshtasticChannelHash('LongFast', CUSTOM_PSK);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(255);
  });

  it('accepts a Node Buffer or a plain Uint8Array interchangeably', () => {
    const asBuffer = computeMeshtasticChannelHash('TGIFMESH', Buffer.from(CUSTOM_PSK));
    const asUint8 = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    expect(asBuffer).toBe(asUint8);
  });
});
