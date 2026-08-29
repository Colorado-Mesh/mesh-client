import { describe, expect, it } from 'vitest';

import {
  BLOCKED_CONTACT_HASH_HEX_LENGTH,
  isValidBlockedContactHash,
  normalizeBlockedHash,
} from './blockedContactHash';

const VALID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('normalizeBlockedHash', () => {
  it('lowercases hex input', () => {
    expect(normalizeBlockedHash(VALID.toUpperCase())).toBe(VALID);
  });

  it('strips colon, dash and whitespace separators', () => {
    expect(normalizeBlockedHash('a1:b2-c3 d4e5f60718293a4b5c6d7e8f90')).toBe(VALID);
  });

  it('is idempotent', () => {
    expect(normalizeBlockedHash(normalizeBlockedHash(VALID))).toBe(VALID);
  });

  it('falls back to the trimmed input when hex-stripping empties the string', () => {
    // Documented lenient behavior retained for existing block/unblock call sites.
    expect(normalizeBlockedHash('  ZZZ  ')).toBe('zzz');
  });
});

describe('isValidBlockedContactHash', () => {
  it('accepts exactly 32 hex characters', () => {
    expect(isValidBlockedContactHash(VALID)).toBe(true);
    expect(isValidBlockedContactHash(VALID.toUpperCase())).toBe(true);
    expect(BLOCKED_CONTACT_HASH_HEX_LENGTH).toBe(32);
  });

  it('accepts separated input that normalizes to 32 hex characters', () => {
    expect(isValidBlockedContactHash('a1:b2:c3:d4:e5:f6:07:18:29:3a:4b:5c:6d:7e:8f:90')).toBe(true);
  });

  it('rejects wrong lengths', () => {
    expect(isValidBlockedContactHash(VALID.slice(0, 31))).toBe(false);
    expect(isValidBlockedContactHash(VALID + 'a')).toBe(false);
  });

  it('rejects non-hex, empty and whitespace-only input', () => {
    expect(isValidBlockedContactHash('z'.repeat(32))).toBe(false);
    expect(isValidBlockedContactHash('')).toBe(false);
    expect(isValidBlockedContactHash('    ')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidBlockedContactHash(undefined)).toBe(false);
    expect(isValidBlockedContactHash(null)).toBe(false);
    expect(isValidBlockedContactHash(12345)).toBe(false);
    expect(isValidBlockedContactHash({ hash: VALID })).toBe(false);
  });

  it('rejects the lenient normalizer fallback so junk is never imported', () => {
    // normalizeBlockedHash('ZZZ') returns 'zzz'; strict validation must still refuse it.
    expect(normalizeBlockedHash('ZZZ')).toBe('zzz');
    expect(isValidBlockedContactHash('ZZZ')).toBe(false);
  });
});
