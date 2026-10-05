import { describe, expect, it } from 'vitest';

import { computeChannelIdentityKey, isChannelIdentityKey } from './channelIdentityKey';

const SECRET_A = new Uint8Array([
  0x1e, 0x2f, 0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x90, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07,
]);
const SECRET_B = new Uint8Array(16).fill(0x42);

describe('computeChannelIdentityKey', () => {
  it('is deterministic for the same protocol, name and secret', () => {
    expect(computeChannelIdentityKey('meshcore', '#emergency', SECRET_A)).toBe(
      computeChannelIdentityKey('meshcore', '#emergency', new Uint8Array(SECRET_A)),
    );
  });

  it('returns a 16-char lowercase hex key', () => {
    const key = computeChannelIdentityKey('meshtastic', 'LongFast', SECRET_A);
    expect(isChannelIdentityKey(key)).toBe(true);
  });

  it('differs when the secret, name or protocol differ', () => {
    const base = computeChannelIdentityKey('meshcore', '#emergency', SECRET_A);
    expect(computeChannelIdentityKey('meshcore', '#emergency', SECRET_B)).not.toBe(base);
    expect(computeChannelIdentityKey('meshcore', '#cm-reach', SECRET_A)).not.toBe(base);
    expect(computeChannelIdentityKey('meshtastic', '#emergency', SECRET_A)).not.toBe(base);
  });

  it('trims surrounding whitespace from the name', () => {
    expect(computeChannelIdentityKey('meshcore', '  #emergency ', SECRET_A)).toBe(
      computeChannelIdentityKey('meshcore', '#emergency', SECRET_A),
    );
  });

  it('does not collide when name bytes shift into the secret', () => {
    expect(computeChannelIdentityKey('meshcore', 'ab', new Uint8Array([0x63]))).not.toBe(
      computeChannelIdentityKey('meshcore', 'abc', new Uint8Array()),
    );
  });
});

describe('isChannelIdentityKey', () => {
  it('rejects non-key values', () => {
    expect(isChannelIdentityKey(null)).toBe(false);
    expect(isChannelIdentityKey('xyz')).toBe(false);
    expect(isChannelIdentityKey('ABCDEF0123456789')).toBe(false);
  });
});
