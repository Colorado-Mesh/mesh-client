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
  label: string;
  description: string;
}

/** Preset hex values — Tailwind palette only. */
export const THEME_COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: 'Green 300', hex: '#86efac' },
  { label: 'Slate 950', hex: '#020617' },
  { label: 'Slate 900', hex: '#0f172a' },
  { label: 'Slate 800', hex: '#1e293b' },
  { label: 'Slate 700', hex: '#334155' },
  { label: 'Slate 400', hex: '#94a3b8' },
  { label: 'White', hex: '#ffffff' },
  { label: 'Black', hex: '#000000' },
  { label: 'Blue 500', hex: '#3b82f6' },
  { label: 'Amber 500', hex: '#f59e0b' },
  { label: 'Red 500', hex: '#ef4444' },
  { label: 'Emerald 500', hex: '#10b981' },
  { label: 'Green 700', hex: '#15803d' },
  { label: 'Violet 500', hex: '#8b5cf6' },
  { label: 'Cyan 400', hex: '#22d3ee' },
  { label: 'Purple 400', hex: '#c084fc' },
  { label: 'Pink 400', hex: '#f472b6' },
  { label: 'Orange 400', hex: '#fb923c' },
  { label: 'Yellow 400', hex: '#facc15' },
];

export const THEME_TOKEN_META: ThemeTokenMeta[] = [
  {
    key: 'appBg',
    label: 'Main window background',
    description:
      'Main content viewport and app window background — the dark canvas behind all panels.',
  },
  {
    key: 'sidebarActiveBg',
    label: 'Active sidebar tab',
    description: 'Background of the currently selected tab in the sidebar navigation.',
  },
  {
    key: 'brandGreen',
    label: 'Indicators & border highlights',
    description:
      'Accent for borders when configured, online/MQTT indicators, highlights, and progress fills.',
  },
  {
    key: 'brightGreen',
    label: 'App title, links & node emphasis',
    description: 'App title, emphasis text, links in footer, and hop/self highlights in node list.',
  },
  {
    key: 'readableGreen',
    label: 'Action buttons & selected pills',
    description:
      'Solid fills with white text—selected channel pills and primary action buttons for contrast.',
  },
  {
    key: 'deepBlack',
    label: 'Sidebar, header & modal surfaces',
    description: 'Sidebar navigation, header, footer, modal shells, and primary dark surfaces.',
  },
  {
    key: 'secondaryDark',
    label: 'Panel & input background',
    description: 'Panel backgrounds, inputs, buttons, table row hovers, and progress track.',
  },
  {
    key: 'muted',
    label: 'Secondary labels & captions',
    description: 'Secondary labels, captions, table headers, and de-emphasized text.',
  },
  {
    key: 'chatIncomingBg',
    label: 'Incoming message fill',
    description: 'Background fill for incoming channel messages (applied at 38% opacity).',
  },
  {
    key: 'chatIncomingBorder',
    label: 'Incoming message border',
    description: 'Border color for incoming channel messages.',
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
  const resolved: Record<ThemeColorKey, string> = { ...DEFAULT_THEME_COLORS };
  for (const key of Object.keys(THEME_CSS_VARS) as ThemeColorKey[]) {
    const hex = resolveThemeHex(colors[key], key);
    if (!hex) {
      console.warn(
        `[themeColors] applyThemeColors skipped — invalid or non-strict hex key=${sanitizeLogMessage(key)} raw=${sanitizeLogMessage(colors[key])}`,
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
