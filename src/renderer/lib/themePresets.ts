import { DEFAULT_THEME_COLORS, type ThemeColorKey } from './themeColors';

export type ThemePresetId = 'default' | 'highContrast' | 'midnight' | 'teal' | 'amber';

export interface ThemePreset {
  id: ThemePresetId;
  labelKey: string;
  /** Every token, so applying a preset replaces the whole palette. */
  colors: Record<ThemeColorKey, string>;
}

function preset(
  id: ThemePresetId,
  labelKey: string,
  overrides: Partial<Record<ThemeColorKey, string>>,
): ThemePreset {
  return { id, labelKey, colors: { ...DEFAULT_THEME_COLORS, ...overrides } };
}

/**
 * One-click palettes for App > Appearance > Colors. Single colors can still be changed afterwards.
 * Every preset keeps text at 4.5:1 or better and passes the green guards in `themeColors.ts`
 * (`themePresets.test.ts`). Dark only: many older panels hard-code dark text colors.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  preset('default', 'appPanel.themePresets.default', {}),
  // Brighter muted text, stronger borders and a lighter green for low vision.
  preset('highContrast', 'appPanel.themePresets.highContrast', {
    sidebarActiveBg: '#334155',
    secondaryDark: '#64748b',
    muted: '#cbd5e1',
    brandGreen: '#bbf7d0',
    brightGreen: '#bbf7d0',
    chatIncomingBg: '#334155',
    chatIncomingBorder: '#64748b',
    chatOutgoingBorder: '#bbf7d0',
    messageActionButtonHover: '#e2e8f0',
  }),
  // Neutral gray surfaces with a sky accent.
  preset('midnight', 'appPanel.themePresets.midnight', {
    appBg: '#030712',
    deepBlack: '#111827',
    sidebarActiveBg: '#1f2937',
    secondaryDark: '#374151',
    muted: '#9ca3af',
    brandGreen: '#7dd3fc',
    brightGreen: '#7dd3fc',
    chatIncomingBg: '#1f2937',
    chatIncomingBorder: '#1f2937',
    chatOutgoingBg: '#0369a1',
    chatOutgoingBorder: '#7dd3fc',
    messageActionsBarBg: '#111827',
    messageActionButtonHover: '#9ca3af',
  }),
  preset('teal', 'appPanel.themePresets.teal', {
    brandGreen: '#5eead4',
    brightGreen: '#5eead4',
    chatOutgoingBg: '#0f766e',
    chatOutgoingBorder: '#5eead4',
  }),
  preset('amber', 'appPanel.themePresets.amber', {
    brandGreen: '#fcd34d',
    brightGreen: '#fcd34d',
    chatOutgoingBg: '#b45309',
    chatOutgoingBorder: '#fcd34d',
  }),
];

/** The preset whose palette matches exactly, or null (the user has custom colors). */
export function matchThemePreset(colors: Record<ThemeColorKey, string>): ThemePresetId | null {
  const keys = Object.keys(DEFAULT_THEME_COLORS) as ThemeColorKey[];
  const found = THEME_PRESETS.find((p) =>
    keys.every((key) => p.colors[key].toLowerCase() === colors[key].toLowerCase()),
  );
  return found?.id ?? null;
}
