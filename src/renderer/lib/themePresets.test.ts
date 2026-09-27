import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_THEME_COLORS } from './themeColors';
import {
  applyThemeSurface,
  DEFAULT_THEME_ACCENT_ID,
  DEFAULT_THEME_SURFACE_ID,
  INK_STEPS,
  loadThemeSurfaceId,
  matchThemeAccent,
  matchThemeSurface,
  persistThemeSurfaceId,
  surfaceThemeColors,
  THEME_ACCENTS,
  THEME_SURFACE_STORAGE_KEY,
  THEME_SURFACES,
  themeColorsFor,
  themeSurface,
  toThemeSurfaceId,
} from './themePresets';
import { contrastRatio, relativeLuminance } from './wcagContrast';

const defaultAccent = THEME_ACCENTS.find((a) => a.id === DEFAULT_THEME_ACCENT_ID)!;

describe('theme surfaces and accents', () => {
  it('have unique ids, and the defaults rebuild DEFAULT_THEME_COLORS', () => {
    expect(new Set(THEME_SURFACES.map((s) => s.id)).size).toBe(THEME_SURFACES.length);
    expect(new Set(THEME_ACCENTS.map((a) => a.id)).size).toBe(THEME_ACCENTS.length);
    expect(themeColorsFor(themeSurface(DEFAULT_THEME_SURFACE_ID), defaultAccent)).toEqual(
      DEFAULT_THEME_COLORS,
    );
  });

  it.each(THEME_SURFACES.map((s) => [s.id, s] as const))(
    '%s is eleven hex steps from lightest to darkest',
    (_id, surface) => {
      const values = INK_STEPS.map((step) => surface.scale[step]);
      for (const hex of values) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      for (let i = 1; i < values.length; i += 1) {
        expect(relativeLuminance(values[i])).toBeLessThanOrEqual(relativeLuminance(values[i - 1]));
      }
    },
  );

  // Night vision draws through a red-only filter and cannot reach WCAG text contrast by design
  // (themePresets.ts), so the readability pairs cover every other surface.
  const readable = THEME_SURFACES.filter((s) => !s.filter);

  it.each(readable.map((s) => [s.id, s] as const))(
    '%s keeps text readable on backgrounds, panels, rows and control fills',
    (_id, surface) => {
      const s = surface.scale;
      for (const bg of [950, 900, 800] as const) {
        expect(contrastRatio(s[400], s[bg])).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(s[300], s[800])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(s[300], s[700])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(s[200], s[700])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(readable.flatMap((s) => THEME_ACCENTS.map((a) => [`${s.id} + ${a.id}`, s, a] as const)))(
    '%s passes the accent guards, so no combination is ever reset',
    (_label, surface, accent) => {
      const c = themeColorsFor(surface, accent);
      for (const bg of [c.appBg, c.deepBlack, c.sidebarActiveBg]) {
        expect(contrastRatio(c.brandGreen, bg)).toBeGreaterThanOrEqual(4.5);
      }
      // Primary fills: app-background text on the accent, and white text on the fill.
      expect(contrastRatio(c.appBg, c.brandGreen)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#ffffff', c.readableGreen)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('High contrast field borders reach 3:1 against panels and field backgrounds', () => {
    const surface = themeSurface('highContrast');
    const c = surfaceThemeColors(surface);
    expect(contrastRatio(c.secondaryDark, c.deepBlack)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c.secondaryDark, c.appBg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(surface.scale[200], c.secondaryDark)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('matching a palette', () => {
  it('names the surface and accent it came from, case-insensitively', () => {
    const zinc = themeSurface('zinc');
    const meshcore = THEME_ACCENTS.find((a) => a.id === 'meshcore')!;
    const colors = { ...themeColorsFor(zinc, meshcore), appBg: '#09090B' };
    expect(matchThemeSurface(colors, 'zinc')).toBe('zinc');
    expect(matchThemeAccent(colors)).toBe('meshcore');
    expect(matchThemeSurface(DEFAULT_THEME_COLORS, DEFAULT_THEME_SURFACE_ID)).toBe('midnight');
    expect(matchThemeAccent(DEFAULT_THEME_COLORS)).toBe('meshtastic');
  });

  it('returns null once a single color is changed by hand', () => {
    expect(matchThemeSurface({ ...DEFAULT_THEME_COLORS, muted: '#abcdef' }, 'midnight')).toBeNull();
    expect(matchThemeAccent({ ...DEFAULT_THEME_COLORS, brandGreen: '#abcdef' })).toBeNull();
  });
});

describe('surface storage', () => {
  beforeEach(() => {
    localStorage.removeItem(THEME_SURFACE_STORAGE_KEY);
  });
  afterEach(() => {
    applyThemeSurface(DEFAULT_THEME_SURFACE_ID);
  });

  it('defaults to Midnight and ignores unknown ids', () => {
    expect(loadThemeSurfaceId()).toBe('midnight');
    localStorage.setItem(THEME_SURFACE_STORAGE_KEY, 'sepia');
    expect(loadThemeSurfaceId()).toBe('midnight');
    expect(toThemeSurfaceId(42)).toBe('midnight');
  });

  it('stores only a non-default choice', () => {
    persistThemeSurfaceId('slate');
    expect(loadThemeSurfaceId()).toBe('slate');
    persistThemeSurfaceId('midnight');
    expect(localStorage.getItem(THEME_SURFACE_STORAGE_KEY)).toBeNull();
  });

  it('points every ink class at the scale and tags the root for window filters', () => {
    applyThemeSurface('zinc');
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-ink-800')).toBe('#27272a');
    expect(root.style.getPropertyValue('--color-ink-50')).toBe('#fafafa');
    expect(root.dataset.themeSurface).toBe('zinc');
    applyThemeSurface('nightVision');
    expect(root.dataset.themeSurface).toBe('nightVision');
  });
});
