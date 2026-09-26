import { DEFAULT_THEME_COLORS, type ThemeColorKey } from './themeColors';

export type ThemePresetId =
  'default' | 'highContrast' | 'midnight' | 'teal' | 'amber' | 'classicSlate';

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
    sidebarActiveBg: '#3f3f46',
    secondaryDark: '#71717a',
    muted: '#d4d4d8',
    brandGreen: '#bbf7d0',
    brightGreen: '#bbf7d0',
    chatIncomingBg: '#3f3f46',
    chatIncomingBorder: '#71717a',
    chatOutgoingBorder: '#bbf7d0',
    messageActionButtonHover: '#e4e4e7',
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
  // The look before the Zinc style guide: slate surfaces with the green-300 accent.
  preset('classicSlate', 'appPanel.themePresets.classicSlate', {
    appBg: '#020617',
    sidebarActiveBg: '#1e293b',
    brandGreen: '#86efac',
    brightGreen: '#86efac',
    readableGreen: '#15803d',
    deepBlack: '#0f172a',
    secondaryDark: '#334155',
    muted: '#94a3b8',
    chatIncomingBg: '#1e293b',
    chatIncomingBorder: '#1e293b',
    chatOutgoingBg: '#15803d',
    chatOutgoingBorder: '#86efac',
    messageActionsBarBg: '#0f172a',
    messageActionButtonHover: '#94a3b8',
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
