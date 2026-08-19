import { describe, expect, it } from 'vitest';

import { computeMeshtasticChannelHash } from './meshtasticChannelHash';

const CUSTOM_PSK = new Uint8Array([
  0x1e, 0x2f, 0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x90, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07,
]);

// This codebase's own default-channel key constant (see MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES /
// mqtt-manager DEFAULT_PSK). Whether that constant itself matches real firmware's default-PSK
// expansion is a separate, unverified question — this only pins THIS hash function's own
// behavior against THIS codebase's key, not firmware parity for the default channel.
const CODEBASE_DEFAULT_PSK = new Uint8Array([
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

describe('computeMeshtasticChannelHash', () => {
  it('XOR-folds the channel name against the key (firmware Channels::generateHash shape)', () => {
    // XOR-fold of "LongFast" bytes = 0x0a; XOR-fold of CODEBASE_DEFAULT_PSK bytes = 0x01.
    expect(computeMeshtasticChannelHash('LongFast', CODEBASE_DEFAULT_PSK)).toBe(0x0b);
  });

  it('is deterministic — same name+PSK always hashes the same', () => {
    const a = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    const b = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    expect(a).toBe(b);
  });

  it('changes when the channel name or PSK changes', () => {
    const base = computeMeshtasticChannelHash('TGIFMESH', CUSTOM_PSK);
    expect(computeMeshtasticChannelHash('OtherName', CUSTOM_PSK)).not.toBe(base);
    expect(computeMeshtasticChannelHash('TGIFMESH', CODEBASE_DEFAULT_PSK)).not.toBe(base);
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
