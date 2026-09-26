import { DEFAULT_THEME_COLORS, type ThemeColorKey } from './themeColors';

export type ThemePresetId =
  'default' | 'meshcore' | 'reticulum' | 'highContrast' | 'midnight' | 'classicSlate';

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
  preset('default', 'appPanel.themePresets.meshtastic', {}),
  // Protocol scales from the style guide as accent themes on the zinc neutrals: MeshCore cyan
  // (400 accent, 700 fills) and Reticulum yellow (400 accent, 700 fills). Default is Meshtastic.
  preset('meshcore', 'appPanel.themePresets.meshcore', {
    brandGreen: '#22d3ee',
    brightGreen: '#22d3ee',
    readableGreen: '#0e7490',
    chatOutgoingBg: '#0e7490',
    chatOutgoingBorder: '#22d3ee',
  }),
  preset('reticulum', 'appPanel.themePresets.reticulum', {
    brandGreen: '#facc15',
    brightGreen: '#facc15',
    readableGreen: '#a16207',
    chatOutgoingBg: '#a16207',
    chatOutgoingBorder: '#facc15',
  }),
  // Brighter muted text, stronger borders and a lighter green for low vision.
  preset('highContrast', 'appPanel.themePresets.highContrast', {
    sidebarActiveBg: '#3f3f46',
    secondaryDark: '#71717a',
    muted: '#d4d4d8',
    brandGreen: '#a7f3d0',
    brightGreen: '#a7f3d0',
    chatIncomingBg: '#3f3f46',
    chatIncomingBorder: '#71717a',
    chatOutgoingBorder: '#a7f3d0',
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
