import { describe, expect, it } from 'vitest';

import { crc32, meshtasticNodeNumFromPublicKeyHex } from './meshtasticNodeNumFromPublicKey';

describe('crc32', () => {
  it('matches the standard IEEE check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('meshtasticNodeNumFromPublicKeyHex', () => {
  it('derives the node number as crc32 of the raw key bytes', () => {
    const hex = 'ab'.repeat(32);
    expect(meshtasticNodeNumFromPublicKeyHex(hex)).toBe(crc32(new Uint8Array(32).fill(0xab)));
    expect(meshtasticNodeNumFromPublicKeyHex(hex.toUpperCase())).toBe(
      meshtasticNodeNumFromPublicKeyHex(hex),
    );
  });

  it('rejects malformed keys', () => {
    expect(meshtasticNodeNumFromPublicKeyHex('abc')).toBeNull();
    expect(meshtasticNodeNumFromPublicKeyHex('zz'.repeat(32))).toBeNull();
  });
});
