// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  expandMeshtasticPskAlias,
  isMeshtasticDefaultPublicPsk,
  MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
  normalizeMeshtasticPskTo16Bytes,
} from './meshtasticDefaultPublicPsk';

describe('expandMeshtasticPskAlias', () => {
  it('returns the default key for alias 1', () => {
    const key = expandMeshtasticPskAlias(1);
    expect(key).toEqual(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES);
  });

  it('increments only the last byte for aliases 2-10', () => {
    for (let i = 2; i <= 10; i++) {
      const key = expandMeshtasticPskAlias(i)!;
      expect(key).toHaveLength(16);
      // First 15 bytes match the default key
      expect(key.subarray(0, 15)).toEqual(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES.subarray(0, 15));
      // Last byte is default + (i - 1), wrapped to 8 bits
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- strict-shared requires non-null on indexed access
      expect(key[15]).toBe((MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES[15]! + (i - 1)) & 0xff);
    }
  });

  it('returns null for alias 0 (no encryption)', () => {
    expect(expandMeshtasticPskAlias(0)).toBeNull();
  });

  it('returns null for out-of-range aliases', () => {
    expect(expandMeshtasticPskAlias(-1)).toBeNull();
    expect(expandMeshtasticPskAlias(11)).toBeNull();
    expect(expandMeshtasticPskAlias(255)).toBeNull();
  });
});

describe('normalizeMeshtasticPskTo16Bytes', () => {
  it('expands one-byte alias 0x01 to the real default key', () => {
    expect(normalizeMeshtasticPskTo16Bytes(new Uint8Array([0x01]))).toEqual(
      MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
    );
  });

  it('expands one-byte alias 0x02 to the simple preset 2', () => {
    const result = normalizeMeshtasticPskTo16Bytes(new Uint8Array([0x02]));
    expect(result).toEqual(expandMeshtasticPskAlias(2));
  });

  it('zero-pads one-byte alias 0x00 (not a valid alias)', () => {
    const result = normalizeMeshtasticPskTo16Bytes(new Uint8Array([0x00]));
    expect(result).toEqual(new Uint8Array(16));
  });

  it('zero-pads short keys that are not one-byte aliases', () => {
    const short = new Uint8Array([0xaa, 0xbb, 0xcc]);
    const result = normalizeMeshtasticPskTo16Bytes(short);
    expect(result).toHaveLength(16);
    expect(result.subarray(0, 3)).toEqual(short);
    expect(result.subarray(3)).toEqual(new Uint8Array(13));
  });

  it('passes through 16-byte keys unchanged', () => {
    const full = new Uint8Array(16).fill(0x42);
    expect(normalizeMeshtasticPskTo16Bytes(full)).toEqual(full);
  });

  it('truncates keys longer than 16 bytes', () => {
    const long = new Uint8Array(32).fill(0xff);
    const result = normalizeMeshtasticPskTo16Bytes(long);
    expect(result).toHaveLength(16);
    expect(result).toEqual(new Uint8Array(16).fill(0xff));
  });

  it('accepts a Node Buffer', () => {
    const buf = Buffer.from([0x01]);
    expect(normalizeMeshtasticPskTo16Bytes(buf)).toEqual(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES);
  });
});

describe('isMeshtasticDefaultPublicPsk', () => {
  it('returns true for AQ== padded 16-byte key material', () => {
    expect(isMeshtasticDefaultPublicPsk(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES)).toBe(true);
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array([0x01]))).toBe(true);
  });

  it('returns false for empty buffer', () => {
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array())).toBe(false);
  });

  it('returns false for non-default PSK', () => {
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array(16).fill(0xff))).toBe(false);
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array([0x02]))).toBe(false);
  });
});
