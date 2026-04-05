/**
 * Runtime theme color overrides for @theme tokens in styles.css.
 * Applied via document.documentElement CSS custom properties.
 */
import { parseStoredJson } from './parseStoredJson';

export const THEME_COLORS_STORAGE_KEY = 'mesh-client:themeColors';

/** Keys persisted in localStorage (camelCase). */
export type ThemeColorKey =
  | 'brandGreen'
  | 'brightGreen'
  | 'readableGreen'
  | 'deepBlack'
  | 'secondaryDark'
  | 'muted';

/** CSS custom property name (no leading --). */
export const THEME_CSS_VARS: Record<ThemeColorKey, string> = {
  brandGreen: '--color-brand-green',
  brightGreen: '--color-bright-green',
  readableGreen: '--color-readable-green',
  deepBlack: '--color-deep-black',
  secondaryDark: '--color-secondary-dark',
  muted: '--color-muted',
};

/** Default hex values — must match src/renderer/styles.css @theme block. */
export const DEFAULT_THEME_COLORS: Record<ThemeColorKey, string> = {
  brandGreen: '#9ae6b4',
  brightGreen: '#9ae6b4',
  readableGreen: '#16a34a',
  deepBlack: '#1a202c',
  secondaryDark: '#2d3748',
  muted: '#a0aec0',
};

export interface ThemeTokenMeta {
  key: ThemeColorKey;
  label: string;
  description: string;
}

/** Preset hex values only — no free typing in App panel (avoids Electron macOS menu bridge warnings). */
export const THEME_COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: 'Default brand', hex: '#9ae6b4' },
  { label: 'Default deep black', hex: '#1a202c' },
  { label: 'Default secondary', hex: '#2d3748' },
  { label: 'Default muted', hex: '#a0aec0' },
  { label: 'White', hex: '#ffffff' },
  { label: 'Black', hex: '#000000' },
  { label: 'Blue', hex: '#3b82f6' },
  { label: 'Amber', hex: '#f59e0b' },
  { label: 'Red', hex: '#ef4444' },
  { label: 'Slate light', hex: '#94a3b8' },
  { label: 'Slate dark', hex: '#334155' },
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Readable green (default)', hex: '#16a34a' },
];

export const THEME_TOKEN_META: ThemeTokenMeta[] = [
  {
    key: 'brandGreen',
    label: 'Brand green',
    description:
      'Accent for borders when configured, online/MQTT indicators, highlights, and progress fills.',
  },
  {
    key: 'brightGreen',
    label: 'Bright green',
    description: 'App title, emphasis text, links in footer, and hop/self highlights in node list.',
  },
  {
    key: 'readableGreen',
    label: 'Readable green',
    description:
      'Solid fills with white text—selected channel pills and primary action buttons for contrast.',
  },
  {
    key: 'deepBlack',
    label: 'Deep black',
    description: 'Header, footer, modal shells, and primary dark surfaces.',
  },
  {
    key: 'secondaryDark',
    label: 'Secondary dark',
    description: 'Panel backgrounds, inputs, buttons, table row hovers, and progress track.',
  },
  {
    key: 'muted',
    label: 'Muted',
    description: 'Secondary labels, captions, table headers, and de-emphasized text.',
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
      console.warn('[themeColors] applyThemeColors skipped — invalid or non-strict hex', {
        key,
        raw: colors[key],
      });
      return;
    }
    resolved[key] = hex;
  }
  const root = document.documentElement;
  for (const key of Object.keys(THEME_CSS_VARS) as ThemeColorKey[]) {
    root.style.setProperty(THEME_CSS_VARS[key], resolved[key]);
  }
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
