import { describe, expect, it, vi } from 'vitest';

import {
  applyThemeColors,
  DEFAULT_THEME_COLORS,
  isValidHex,
  loadThemeColors,
  normalizeHex,
  sanitizeHexDraft,
  THEME_COLORS_STORAGE_KEY,
} from './themeColors';
import { contrastRatio } from './wcagContrast';

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

  it('readableGreen meets WCAG AA 4.5:1 with white text', () => {
    expect(contrastRatio('#ffffff', DEFAULT_THEME_COLORS.readableGreen)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  describe('loadThemeColors', () => {
    it('migrates persisted legacy readableGreen (#16a34a) to accessible default', () => {
      localStorage.setItem(THEME_COLORS_STORAGE_KEY, JSON.stringify({ readableGreen: '#16a34a' }));
      const colors = loadThemeColors();
      expect(colors.readableGreen).toBe('#15803d');
      expect(localStorage.getItem(THEME_COLORS_STORAGE_KEY)).toBeNull();
    });

    it('keeps accessible readableGreen override', () => {
      localStorage.setItem(THEME_COLORS_STORAGE_KEY, JSON.stringify({ readableGreen: '#14532d' }));
      const colors = loadThemeColors();
      expect(colors.readableGreen).toBe('#14532d');
    });
  });

  describe('applyThemeColors', () => {
    it('sets chatIncomingBg as rgb() with 0.38 opacity, not bare hex', () => {
      const setProp = vi.fn();
      vi.spyOn(document.documentElement.style, 'setProperty').mockImplementation(setProp);
      applyThemeColors({ ...DEFAULT_THEME_COLORS, chatIncomingBg: '#1e293b' });
      const call = setProp.mock.calls.find(([prop]) => prop === '--color-chat-incoming-bg');
      expect(call).toBeDefined();
      expect(call![1]).toBe('rgb(30 41 59 / 0.38)');
      vi.restoreAllMocks();
    });

    it('sets appBg as bare hex', () => {
      const setProp = vi.fn();
      vi.spyOn(document.documentElement.style, 'setProperty').mockImplementation(setProp);
      applyThemeColors({ ...DEFAULT_THEME_COLORS, appBg: '#020617' });
      const call = setProp.mock.calls.find(([prop]) => prop === '--color-app-bg');
      expect(call).toBeDefined();
      expect(call![1]).toBe('#020617');
      vi.restoreAllMocks();
    });

    it('coerces inaccessible readableGreen to accessible default before applying', () => {
      const setProp = vi.fn();
      vi.spyOn(document.documentElement.style, 'setProperty').mockImplementation(setProp);
      applyThemeColors({ ...DEFAULT_THEME_COLORS, readableGreen: '#16a34a' });
      const call = setProp.mock.calls.find(([prop]) => prop === '--color-readable-green');
      expect(call).toBeDefined();
      expect(call![1]).toBe('#15803d');
      expect(localStorage.getItem(THEME_COLORS_STORAGE_KEY)).toBeNull();
      vi.restoreAllMocks();
    });
  });
});
