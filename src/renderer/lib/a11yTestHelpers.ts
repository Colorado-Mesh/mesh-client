import { applyThemeColors, loadThemeColors } from './themeColors';

/** Tailwind badge fills used in axe tests — jsdom does not load styles.css. */
const AXE_BG_CLASS_TO_CSS: Record<string, string> = {
  'bg-readable-green': '--color-readable-green',
  'bg-cyan-800': '#155e75',
  'bg-amber-800': '#92400e',
};

const AXE_TEXT_CLASS_TO_CSS: Record<string, string> = {
  'text-white': '#ffffff',
};

function resolveThemeBg(tokenOrHex: string): string {
  if (tokenOrHex.startsWith('--')) {
    const fromRoot = getComputedStyle(document.documentElement).getPropertyValue(tokenOrHex).trim();
    return fromRoot || '#15803d';
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
