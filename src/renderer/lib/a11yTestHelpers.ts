import {
  applyThemeColors,
  DEFAULT_THEME_COLORS,
  loadThemeColors,
  THEME_CSS_VARS,
  type ThemeColorKey,
} from './themeColors';

/** Tailwind badge fills used in axe tests — jsdom does not load styles.css. */
const AXE_BG_CLASS_TO_CSS: Record<string, string> = {
  'bg-readable-green': '--color-readable-green',
  'bg-brand-green': '--color-brand-green',
  'bg-secondary-dark': '--color-secondary-dark',
  'bg-cyan-800': '#155e75',
  'bg-cyan-700': '#0e7490',
  'bg-meshtastic-700': '#047857',
  'bg-meshcore-700': '#0e7490',
  'bg-reticulum-700': '#a16207',
  'bg-orange-700': '#c2410c',
  'bg-orange-800': '#9a3412',
};

const AXE_TEXT_CLASS_TO_CSS: Record<string, string> = {
  'text-zinc-300': '#d4d4d8',
  'text-white': '#ffffff',
  'text-app-bg': '#111113',
};

const DEFAULT_HEX_BY_CSS_VAR: Record<string, string> = Object.fromEntries(
  (Object.keys(THEME_CSS_VARS) as ThemeColorKey[]).map((key) => [
    THEME_CSS_VARS[key],
    DEFAULT_THEME_COLORS[key],
  ]),
);

function resolveThemeBg(tokenOrHex: string): string {
  if (tokenOrHex.startsWith('--')) {
    const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(tokenOrHex).trim();
    return fromRoot || DEFAULT_HEX_BY_CSS_VAR[tokenOrHex] || '#15803d';
  }
  return tokenOrHex;
}

/** Apply theme CSS vars and inline colors so vitest-axe color-contrast runs against real hex values. */
export function hydrateAxeThemeColors(root: Element): void {
  applyThemeColors(loadThemeColors());

  const nodes =
    root instanceof HTMLElement
      ? [root, ...root.querySelectorAll('*')]
      : [...root.querySelectorAll('*')];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    for (const cls of node.classList) {
      const bgToken = AXE_BG_CLASS_TO_CSS[cls];
      if (bgToken) {
        node.style.backgroundColor = resolveThemeBg(bgToken);
      }
      const textHex = AXE_TEXT_CLASS_TO_CSS[cls];
      if (textHex) {
        node.style.color = textHex;
      }
    }
  }
}

/** Inner text label from ProtocolUnreadBadge (contrast-bearing element). */
export function getProtocolUnreadBadgeLabel(wrapper: Element): HTMLElement {
  const label = wrapper.querySelector('[data-protocol-unread-label]');
  if (!(label instanceof HTMLElement)) {
    throw new Error('protocol unread badge label not found');
  }
  return label;
}
