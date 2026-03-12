import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_COLORS, isValidHex, normalizeHex, sanitizeHexDraft } from './themeColors';

describe('themeColors', () => {
  describe('normalizeHex', () => {
    it('accepts 6-digit hex', () => {
      expect(normalizeHex('#9ae6b4')).toBe('#9ae6b4');
      expect(normalizeHex('#1A202C')).toBe('#1a202c');
    });
    it('accepts 3-digit hex and expands', () => {
      expect(normalizeHex('#abc')).toBe('#aabbcc');
    });
    it('accepts bare 3 or 6 hex digits and normalizes', () => {
      expect(normalizeHex('9ae6b4')).toBe('#9ae6b4');
      expect(normalizeHex('abc')).toBe('#aabbcc');
    });
    it('rejects invalid', () => {
      expect(normalizeHex('9ae6b')).toBeNull();
      expect(normalizeHex('9ae6b45')).toBeNull();
      expect(normalizeHex('#gggggg')).toBeNull();
      expect(normalizeHex('#12')).toBeNull();
      expect(normalizeHex('')).toBeNull();
    });
  });

  describe('isValidHex', () => {
    it('matches normalizeHex truthiness', () => {
      expect(isValidHex('#fff')).toBe(true);
      expect(isValidHex('#ffffff')).toBe(true);
      expect(isValidHex('no')).toBe(false);
    });
  });

  describe('sanitizeHexDraft', () => {
    it('prefixes # when typing digits only', () => {
      expect(sanitizeHexDraft('9ae6b4')).toBe('#9ae6b4');
      expect(sanitizeHexDraft('abc')).toBe('#abc');
    });
    it('strips non-hex after # and caps length', () => {
      expect(sanitizeHexDraft('#FFFFFFFFF')).toBe('#ffffff');
      expect(sanitizeHexDraft('#12zz34')).toBe('#1234');
    });
    it('rejects bare input with non-hex letters', () => {
      expect(sanitizeHexDraft('hello')).toBe('#');
      expect(sanitizeHexDraft('12zz34')).toBe('#');
    });
    it('empty becomes #', () => {
      expect(sanitizeHexDraft('')).toBe('#');
    });
  });

  it('DEFAULT_THEME_COLORS has all keys as valid hex', () => {
    for (const hex of Object.values(DEFAULT_THEME_COLORS)) {
      expect(normalizeHex(hex)).toBe(hex.toLowerCase());
    }
  });
});
