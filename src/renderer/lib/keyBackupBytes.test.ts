import { describe, expect, it } from 'vitest';

import {
  keyBackupBase64ToBytes,
  keyBackupBytesToBase64,
  nodeNumDisplayHex,
  publicKeyPrefixHex,
} from './keyBackupBytes';

describe('keyBackupBytesToBase64', () => {
  it('encodes 0x00..0xff bytes to base64', () => {
    const oneByte = new Uint8Array([0x00]);
    const full = new Uint8Array([0xff]);
    expect(keyBackupBytesToBase64(oneByte)).toBe('AA==');
    expect(keyBackupBytesToBase64(full)).toBe('/w==');
  });

  it('encodes two bytes correctly', () => {
    expect(keyBackupBytesToBase64(new Uint8Array([0x01, 0x02]))).toBe('AQI=');
  });
});

describe('keyBackupBase64ToBytes', () => {
  it('decodes valid base64 payloads', () => {
    expect([...keyBackupBase64ToBytes('AA==')]).toEqual([0x00]);
    expect([...keyBackupBase64ToBytes('/w==')]).toEqual([0xff]);
    expect([...keyBackupBase64ToBytes('AQI=')]).toEqual([0x01, 0x02]);
  });

  it('round-trips common payloads', () => {
    const original = new Uint8Array([0x12, 0x34, 0x56]);
    const b64 = keyBackupBytesToBase64(original);
    const decoded = keyBackupBase64ToBytes(b64);
    expect(decoded.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(decoded[i]).toBe(original[i]);
    }
  });
});

describe('publicKeyPrefixHex', () => {
  it('extracts 8 hex chars from first 4 bytes', () => {
    const pk = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89]);
    expect(publicKeyPrefixHex(pk, 8)).toBe('01234567');
  });

  it('truncates to requested chars', () => {
    const pk = new Uint8Array([0xab, 0xcd, 0xef, 0x01]);
    expect(publicKeyPrefixHex(pk, 4)).toBe('abcd');
    expect(publicKeyPrefixHex(pk, 2)).toBe('ab');
    expect(publicKeyPrefixHex(pk, 1)).toBe('a');
  });
});

describe('nodeNumDisplayHex', () => {
  it('displays 0 as 00000000', () => {
    expect(nodeNumDisplayHex(0)).toBe('00000000');
  });

  it('displays max positive number', () => {
    expect(nodeNumDisplayHex(0xffffffff)).toBe('FFFFFFFF');
  });

  it('displays a full 8-digit hex value', () => {
    expect(nodeNumDisplayHex(0x1fffffff)).toBe('1FFFFFFF');
    expect(nodeNumDisplayHex(0x20000000)).toBe('20000000');
    // Values above 32 bits are truncated by the `>>> 0` unsigned coercion.
    expect(nodeNumDisplayHex(0x1_0000_0000)).toBe('00000000');
    expect(nodeNumDisplayHex(-1)).toBe('FFFFFFFF');
  });
});
