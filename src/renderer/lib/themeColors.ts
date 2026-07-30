/**
 * Runtime theme color overrides for @theme tokens in styles.css.
 * Applied via document.documentElement CSS custom properties.
 */
import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { parseStoredJson } from './parseStoredJson';
import { contrastRatio } from './wcagContrast';

export const THEME_COLORS_STORAGE_KEY = 'mesh-client:themeColors';

/** Keys persisted in localStorage (camelCase). */
export type ThemeColorKey =
  | 'appBg'
  | 'sidebarActiveBg'
  | 'brandGreen'
  | 'brightGreen'
  | 'readableGreen'
  | 'deepBlack'
  | 'secondaryDark'
  | 'muted'
  | 'chatIncomingBg'
  | 'chatIncomingBorder';

/** CSS custom property name (no leading --). */
export const THEME_CSS_VARS: Record<ThemeColorKey, string> = {
  appBg: '--color-app-bg',
  sidebarActiveBg: '--color-sidebar-active-bg',
  brandGreen: '--color-brand-green',
  brightGreen: '--color-bright-green',
  readableGreen: '--color-readable-green',
  deepBlack: '--color-deep-black',
  secondaryDark: '--color-secondary-dark',
  muted: '--color-muted',
  chatIncomingBg: '--color-chat-incoming-bg',
  chatIncomingBorder: '--color-chat-incoming-border',
};

/** Default hex values — must match src/renderer/styles.css @theme block. */
export const DEFAULT_THEME_COLORS: Record<ThemeColorKey, string> = {
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
};

export interface ThemeTokenMeta {
  key: ThemeColorKey;
  labelKey: string;
  descriptionKey: string;
}

/** Preset hex values — Tailwind palette only. */
export const THEME_COLOR_PRESETS: { labelKey: string; hex: string }[] = [
  { labelKey: 'appPanel.themePreset.green300', hex: '#86efac' },
  { labelKey: 'appPanel.themePreset.slate950', hex: '#020617' },
  { labelKey: 'appPanel.themePreset.slate900', hex: '#0f172a' },
  { labelKey: 'appPanel.themePreset.slate800', hex: '#1e293b' },
  { labelKey: 'appPanel.themePreset.slate700', hex: '#334155' },
  { labelKey: 'appPanel.themePreset.slate400', hex: '#94a3b8' },
  { labelKey: 'appPanel.themePreset.white', hex: '#ffffff' },
  { labelKey: 'appPanel.themePreset.black', hex: '#000000' },
  { labelKey: 'appPanel.themePreset.blue500', hex: '#3b82f6' },
  { labelKey: 'appPanel.themePreset.amber500', hex: '#f59e0b' },
  { labelKey: 'appPanel.themePreset.red500', hex: '#ef4444' },
  { labelKey: 'appPanel.themePreset.emerald500', hex: '#10b981' },
  { labelKey: 'appPanel.themePreset.green700', hex: '#15803d' },
  { labelKey: 'appPanel.themePreset.violet500', hex: '#8b5cf6' },
  { labelKey: 'appPanel.themePreset.cyan400', hex: '#22d3ee' },
  { labelKey: 'appPanel.themePreset.purple400', hex: '#c084fc' },
  { labelKey: 'appPanel.themePreset.pink400', hex: '#f472b6' },
  { labelKey: 'appPanel.themePreset.orange400', hex: '#fb923c' },
  { labelKey: 'appPanel.themePreset.yellow400', hex: '#facc15' },
];

export const THEME_TOKEN_META: ThemeTokenMeta[] = [
  {
    key: 'appBg',
    labelKey: 'appPanel.theme.appBg.label',
    descriptionKey: 'appPanel.theme.appBg.description',
  },
  {
    key: 'sidebarActiveBg',
    labelKey: 'appPanel.theme.sidebarActiveBg.label',
    descriptionKey: 'appPanel.theme.sidebarActiveBg.description',
  },
  {
    key: 'brandGreen',
    labelKey: 'appPanel.theme.brandGreen.label',
    descriptionKey: 'appPanel.theme.brandGreen.description',
  },
  {
    key: 'brightGreen',
    labelKey: 'appPanel.theme.brightGreen.label',
    descriptionKey: 'appPanel.theme.brightGreen.description',
  },
  {
    key: 'readableGreen',
    labelKey: 'appPanel.theme.readableGreen.label',
    descriptionKey: 'appPanel.theme.readableGreen.description',
  },
  {
    key: 'deepBlack',
    labelKey: 'appPanel.theme.deepBlack.label',
    descriptionKey: 'appPanel.theme.deepBlack.description',
  },
  {
    key: 'secondaryDark',
    labelKey: 'appPanel.theme.secondaryDark.label',
    descriptionKey: 'appPanel.theme.secondaryDark.description',
  },
  {
    key: 'muted',
    labelKey: 'appPanel.theme.muted.label',
    descriptionKey: 'appPanel.theme.muted.description',
  },
  {
    key: 'chatIncomingBg',
    labelKey: 'appPanel.theme.chatIncomingBg.label',
    descriptionKey: 'appPanel.theme.chatIncomingBg.description',
  },
  {
    key: 'chatIncomingBorder',
    labelKey: 'appPanel.theme.chatIncomingBorder.label',
    descriptionKey: 'appPanel.theme.chatIncomingBorder.description',
  },
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const BARE_HEX3 = /^[0-9a-fA-F]{3}$/;
const BARE_HEX6 = /^[0-9a-fA-F]{6}$/;

/**
 * Returns normalized #rrggbb or null if invalid.
 * Accepts #rgb, #rrggbb, or bare rgb / rrggbb (prefix # added implicitly).
 */
export function normalizeHex(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!s.startsWith('#')) {
    if (BARE_HEX3.test(s) || BARE_HEX6.test(s)) s = `#${s}`;
    else return null;
  }
  if (!HEX_RE.test(s)) return null;
  if (s.length === 4) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return s.toLowerCase();
}

/**
 * Sanitize user input for the hex text field: only # and hex digits, at most
 * # + 6 digits so values like #FFFFFFFFF cannot be entered. If the user
 * types digits without #, prefix # so the field always shows a valid prefix.
 * If the string contains any non-hex character (except leading #), result is #.
 */
export function sanitizeHexDraft(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '#';
  if (trimmed.startsWith('#')) {
    const rest = trimmed
      .slice(1)
      .replace(/[^0-9a-f]/gi, '')
      .slice(0, 6)
      .toLowerCase();
    return rest ? `#${rest}` : '#';
  }
  // No #: only accept if every character is a hex digit (prefix # for user)
  if (!/^[0-9a-f]*$/i.test(trimmed)) return '#';
  const digits = trimmed.slice(0, 6).toLowerCase();
  return digits ? `#${digits}` : '#';
}

export function isValidHex(input: string): boolean {
  return normalizeHex(input) !== null;
}

/** Only #rrggbb lowercase — refuse to touch DOM otherwise (avoids passing odd strings into Chromium/Electron style pipeline). */
const STRICT_HEX6 = /^#[0-9a-f]{6}$/;

function resolveThemeHex(raw: string | undefined, key: ThemeColorKey): string | null {
  const fallback = DEFAULT_THEME_COLORS[key];
  const hex = normalizeHex(raw ?? fallback) ?? normalizeHex(fallback);
  return hex && STRICT_HEX6.test(hex) ? hex : null;
}

/**
 * Apply theme colors to :root. Pass full map (merged with defaults) so every var is set.
 * If any value is not strictly # + 6 hex after normalize, skips all setProperty calls
 * and logs once — never applies partial/unsane strings.
 */
export function applyThemeColors(colors: Record<ThemeColorKey, string>): void {
  const merged = { ...colors };
  if (ensureReadableGreenContrast(merged)) {
    persistThemeColors(merged);
  }
  const resolved: Record<ThemeColorKey, string> = { ...DEFAULT_THEME_COLORS };
  for (const key of Object.keys(THEME_CSS_VARS) as ThemeColorKey[]) {
    const hex = resolveThemeHex(merged[key], key);
    if (!hex) {
      console.warn(
        `[themeColors] applyThemeColors skipped — invalid or non-strict hex key=${sanitizeLogMessage(key)} raw=${sanitizeLogMessage(merged[key])}`,
      );
      return;
    }
    resolved[key] = hex;
  }
  const root = document.documentElement;
  for (const key of Object.keys(THEME_CSS_VARS) as ThemeColorKey[]) {
    const hex = resolved[key];
    if (key === 'chatIncomingBg') {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      root.style.setProperty(THEME_CSS_VARS[key], `rgb(${r} ${g} ${b} / 0.38)`);
    } else {
      root.style.setProperty(THEME_CSS_VARS[key], hex);
    }
  }
}

const READABLE_GREEN_ON_WHITE_MIN_RATIO = 4.5;

/** readableGreen is for white-on-green fills — persisted overrides must meet WCAG AA. */
function ensureReadableGreenContrast(colors: Record<ThemeColorKey, string>): boolean {
  const hex = normalizeHex(colors.readableGreen);
  if (!hex || contrastRatio('#ffffff', hex) < READABLE_GREEN_ON_WHITE_MIN_RATIO) {
    const wasDifferent = colors.readableGreen !== DEFAULT_THEME_COLORS.readableGreen;
    colors.readableGreen = DEFAULT_THEME_COLORS.readableGreen;
    return wasDifferent;
  }
  return false;
}

export type StoredThemeColors = Partial<Record<ThemeColorKey, string>>;

/**
 * Load persisted overrides and merge with defaults. Does not apply — caller calls applyThemeColors.
 */
export function loadThemeColors(): Record<ThemeColorKey, string> {
  const parsed = parseStoredJson<StoredThemeColors>(
    localStorage.getItem(THEME_COLORS_STORAGE_KEY),
    'themeColors loadThemeColors',
  );
  const merged = { ...DEFAULT_THEME_COLORS };
  if (parsed) {
    for (const key of Object.keys(DEFAULT_THEME_COLORS) as ThemeColorKey[]) {
      const v = parsed[key];
      if (typeof v === 'string' && normalizeHex(v)) merged[key] = normalizeHex(v)!;
    }
  }
  if (ensureReadableGreenContrast(merged)) {
    persistThemeColors(merged);
  }
  return merged;
}

export function persistThemeColors(colors: Record<ThemeColorKey, string>): void {
  const toStore: StoredThemeColors = {};
  for (const key of Object.keys(DEFAULT_THEME_COLORS) as ThemeColorKey[]) {
    const hex = normalizeHex(colors[key]);
    if (hex && hex !== DEFAULT_THEME_COLORS[key]) toStore[key] = hex;
  }
  if (Object.keys(toStore).length === 0) {
    localStorage.removeItem(THEME_COLORS_STORAGE_KEY);
  } else {
    localStorage.setItem(THEME_COLORS_STORAGE_KEY, JSON.stringify(toStore));
  }
}

export function resetThemeColors(): void {
  localStorage.removeItem(THEME_COLORS_STORAGE_KEY);
  applyThemeColors(DEFAULT_THEME_COLORS);
}

export const THEME_COLORS_SNAPSHOT_STORAGE_KEY = 'mesh-client:themeColorsSnapshot';

/** True if the user has an explicitly saved color checkpoint to restore. */
export function hasThemeSnapshot(): boolean {
  return localStorage.getItem(THEME_COLORS_SNAPSHOT_STORAGE_KEY) !== null;
}

/** Save the current live colors as a checkpoint, distinct from factory defaults. */
export function saveThemeSnapshot(): void {
  const current = loadThemeColors();
  localStorage.setItem(THEME_COLORS_SNAPSHOT_STORAGE_KEY, JSON.stringify(current));
}

/** Restore the last saved checkpoint (if any), applying and persisting it as the current colors. */
export function restoreThemeSnapshot(): Record<ThemeColorKey, string> {
  const parsed = parseStoredJson<StoredThemeColors>(
    localStorage.getItem(THEME_COLORS_SNAPSHOT_STORAGE_KEY),
    'themeColors restoreThemeSnapshot',
  );
  const merged = { ...DEFAULT_THEME_COLORS };
  if (parsed) {
    for (const key of Object.keys(DEFAULT_THEME_COLORS) as ThemeColorKey[]) {
      const v = parsed[key];
      if (typeof v === 'string' && normalizeHex(v)) merged[key] = normalizeHex(v)!;
    }
  }
  ensureReadableGreenContrast(merged);
  persistThemeColors(merged);
  applyThemeColors(merged);
  return merged;
}
