import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyThemeColors,
  DEFAULT_THEME_COLORS,
  hasThemeSnapshot,
  isValidHex,
  loadThemeColors,
  normalizeHex,
  persistThemeColors,
  resetThemeColors,
  restoreThemeSnapshot,
  sanitizeHexDraft,
  saveThemeSnapshot,
  THEME_COLORS_SNAPSHOT_STORAGE_KEY,
  THEME_COLORS_STORAGE_KEY,
  THEME_TOKEN_META,
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

  it('THEME_TOKEN_META uses i18n labelKey and descriptionKey for every token', () => {
    for (const meta of THEME_TOKEN_META) {
      expect(meta.labelKey).toMatch(/^appPanel\.theme\./);
      expect(meta.descriptionKey).toMatch(/^appPanel\.theme\./);
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
      const applied = applyThemeColors({ ...DEFAULT_THEME_COLORS, readableGreen: '#16a34a' });
      const call = setProp.mock.calls.find(([prop]) => prop === '--color-readable-green');
      expect(call).toBeDefined();
      expect(call![1]).toBe('#15803d');
      expect(applied?.readableGreen).toBe('#15803d');
      expect(localStorage.getItem(THEME_COLORS_STORAGE_KEY)).toBeNull();
      vi.restoreAllMocks();
    });

    it('returns the resolved map so callers can persist the clamped colors', () => {
      const applied = applyThemeColors({ ...DEFAULT_THEME_COLORS, appBg: '#112233' });
      expect(applied).not.toBeNull();
      expect(applied!.appBg).toBe('#112233');
      expect(applied!.readableGreen).toBe(DEFAULT_THEME_COLORS.readableGreen);
    });
  });

  describe('theme snapshot save/restore', () => {
    beforeEach(() => {
      localStorage.removeItem(THEME_COLORS_STORAGE_KEY);
      localStorage.removeItem(THEME_COLORS_SNAPSHOT_STORAGE_KEY);
    });

    it('hasThemeSnapshot is false until a snapshot is saved', () => {
      expect(hasThemeSnapshot()).toBe(false);
      saveThemeSnapshot();
      expect(hasThemeSnapshot()).toBe(true);
    });

    it('saveThemeSnapshot captures the current live colors', () => {
      persistThemeColors({ ...DEFAULT_THEME_COLORS, appBg: '#123456' });
      saveThemeSnapshot();
      const stored = JSON.parse(
        localStorage.getItem(THEME_COLORS_SNAPSHOT_STORAGE_KEY) ?? '{}',
      ) as Record<string, string>;
      expect(stored.appBg).toBe('#123456');
    });

    it('restoreThemeSnapshot re-applies and persists the saved checkpoint', () => {
      persistThemeColors({ ...DEFAULT_THEME_COLORS, appBg: '#123456' });
      saveThemeSnapshot();

      // Simulate further edits after the checkpoint was saved.
      persistThemeColors({ ...DEFAULT_THEME_COLORS, appBg: '#abcdef' });
      expect(loadThemeColors().appBg).toBe('#abcdef');

      const restored = restoreThemeSnapshot();
      expect(restored.appBg).toBe('#123456');
      expect(loadThemeColors().appBg).toBe('#123456');
    });

    it('restoreThemeSnapshot with no saved snapshot falls back to factory defaults', () => {
      expect(hasThemeSnapshot()).toBe(false);
      const restored = restoreThemeSnapshot();
      expect(restored).toEqual(DEFAULT_THEME_COLORS);
    });

    it('restore does not clear the snapshot, and reset does not touch it either', () => {
      persistThemeColors({ ...DEFAULT_THEME_COLORS, appBg: '#123456' });
      saveThemeSnapshot();
      restoreThemeSnapshot();
      expect(hasThemeSnapshot()).toBe(true);

      resetThemeColors();
      expect(hasThemeSnapshot()).toBe(true);
      expect(restoreThemeSnapshot().appBg).toBe('#123456');
    });
  });
});
