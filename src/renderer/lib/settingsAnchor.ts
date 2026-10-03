/**
 * Settings-search jump target: find a `data-setting-anchor` element inside one panel, open any
 * collapsed `<details>` around it, scroll it to mid-viewport, flash it and focus its first control.
 */

export const SETTING_ANCHOR_ATTR = 'data-setting-anchor';
export const SETTING_ANCHOR_FLASH_ATTR = 'data-setting-flash';
export const SETTING_ANCHOR_FLASH_MS = 2400;
export const SETTING_ANCHOR_QUERY_TIMEOUT_MS = 600;

const FOCUSABLE_CONTROL_SELECTOR =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]';

export interface RevealSettingAnchorOptions {
  /** Index into TAB_SLOT_IDS. Scopes the lookup so a hidden panel cannot match. */
  panelIndex: number;
  /** Move focus to the first control inside the anchor. */
  focusFirstControl?: boolean;
  /** false under App > Appearance > Reduce motion. */
  animate?: boolean;
}

/** Returns true when the anchor was found and revealed. */
export function revealSettingAnchor(id: string, options: RevealSettingAnchorOptions): boolean {
  const host = document.getElementById(`panel-${options.panelIndex}`);
  if (!host || host.hidden) return false;
  const el = Array.from(host.querySelectorAll<HTMLElement>(`[${SETTING_ANCHOR_ATTR}]`)).find(
    (node) => node.getAttribute(SETTING_ANCHOR_ATTR) === id,
  );
  if (!el || el.closest('[hidden]')) return false;
  // The anchor itself may be a collapsible section (RadioPanel's ConfigSection is a <details>).
  for (let node: HTMLElement | null = el; node && node !== host; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement && !node.open) node.open = true;
  }
  el.scrollIntoView({ behavior: options.animate === false ? 'auto' : 'smooth', block: 'center' });
  el.setAttribute(SETTING_ANCHOR_FLASH_ATTR, '');
  window.setTimeout(() => {
    el.removeAttribute(SETTING_ANCHOR_FLASH_ATTR);
  }, SETTING_ANCHOR_FLASH_MS);
  if (options.focusFirstControl) {
    const control = el.matches(FOCUSABLE_CONTROL_SELECTOR)
      ? el
      : el.querySelector<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR);
    control?.focus({ preventScroll: true });
  }
  return true;
}
