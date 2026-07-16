import { describe, expect, it } from 'vitest';

import { bytesToHex, hexToBytesExact, hexToBytesExactOrThrow, hexToBytesLenient } from './hexBytes';

describe('bytesToHex', () => {
  it('encodes bytes as lowercase hex', () => {
    expect(bytesToHex(new Uint8Array([0, 1, 255, 16]))).toBe('0001ff10');
  });

  it('coerces negative byte values into range', () => {
    expect(bytesToHex([-1, -16])).toBe('fff0');
  });

  it('returns empty string for empty input', () => {
    expect(bytesToHex([])).toBe('');
  });
});

describe('hexToBytesLenient', () => {
  it('strips non-hex characters before decoding', () => {
    expect(hexToBytesLenient('de:ad be ef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('returns empty array for odd-length input', () => {
    expect(hexToBytesLenient('abc')).toEqual(new Uint8Array());
  });

  it('returns empty array for empty input', () => {
    expect(hexToBytesLenient('')).toEqual(new Uint8Array());
  });
});

describe('hexToBytesExact', () => {
  it('decodes hex matching the exact required byte length', () => {
    expect(hexToBytesExact('deadbeef', 4)).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('returns undefined when length does not match', () => {
    expect(hexToBytesExact('dead', 4)).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(hexToBytesExact(undefined, 4)).toBeUndefined();
  });

  it('returns undefined for non-hex characters', () => {
    expect(hexToBytesExact('zzzzzzzz', 4)).toBeUndefined();
  });
});

describe('hexToBytesExactOrThrow', () => {
  it('decodes valid hex', () => {
    expect(hexToBytesExactOrThrow('deadbeef', 4)).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it('throws a descriptive error for invalid hex', () => {
    expect(() => hexToBytesExactOrThrow('dead', 4)).toThrow(/8 hexadecimal characters/);
  });
});
