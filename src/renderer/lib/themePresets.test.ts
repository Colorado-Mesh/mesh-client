import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_COLORS } from './themeColors';
import { matchThemePreset, THEME_PRESETS } from './themePresets';
import { contrastRatio } from './wcagContrast';

const SLATE_200 = '#e2e8f0';

describe('THEME_PRESETS', () => {
  it('starts with the default palette and has unique ids', () => {
    expect(THEME_PRESETS[0]?.colors).toEqual(DEFAULT_THEME_COLORS);
    expect(new Set(THEME_PRESETS.map((p) => p.id)).size).toBe(THEME_PRESETS.length);
  });

  it.each(THEME_PRESETS.map((p) => [p.id, p] as const))(
    '%s keeps text and accents readable',
    (_id, preset) => {
      const c = preset.colors;
      for (const surface of [c.appBg, c.deepBlack]) {
        expect(contrastRatio(c.muted, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(SLATE_200, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.brandGreen, surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.brightGreen, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(c.muted, c.sidebarActiveBg)).toBeGreaterThanOrEqual(4.5);
      // Primary fills: dark app background text on the accent. This and the readable green
      // check below are exactly the guards in themeColors.ts, so no preset is ever reset.
      expect(contrastRatio(c.appBg, c.brandGreen)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#ffffff', c.readableGreen)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('matchThemePreset', () => {
  it('names the preset a palette came from, case-insensitively', () => {
    const meshcore = THEME_PRESETS.find((p) => p.id === 'meshcore');
    expect(meshcore).toBeDefined();
    if (!meshcore) return;
    expect(matchThemePreset({ ...meshcore.colors, brandGreen: '#00D3F2' })).toBe('meshcore');
    expect(matchThemePreset({ ...DEFAULT_THEME_COLORS })).toBe('default');
  });

  it('returns null for custom colors', () => {
    expect(matchThemePreset({ ...DEFAULT_THEME_COLORS, muted: '#abcdef' })).toBeNull();
  });
});
