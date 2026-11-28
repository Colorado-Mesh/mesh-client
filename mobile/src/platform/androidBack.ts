/**
 * Android system Back (button or gesture). The desktop renderer has no Back: its popups, sheets
 * and dialogs close on Escape or an outside press. Back closes the innermost thing that is open,
 * one per press:
 *
 * 1. An open popup (a menu or list a button opened: a visible trigger with `aria-expanded="true"`
 *    and `aria-haspopup`) gets Escape; popups that ignore Escape (the language picker closes only on
 *    an outside press or its own button) are closed by pressing their trigger button again.
 * 2. An open inline emoji picker (the chat reaction and compose pickers, opened by buttons that
 *    carry no `aria-expanded`) gets Escape, which the chat panel closes it on.
 * 3. Otherwise the topmost shown dialog gets Escape.
 * 4. Message actions opened by a tap (viewport/touchMessageActions.ts) close.
 * 5. With nothing open the app moves to the background (the Android convention at a root screen),
 *    which keeps radio connections running instead of finishing the activity.
 */

import { ACTIONS_OPEN_ATTR } from '../viewport/touchMessageActions';

const DIALOG_SELECTOR = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]';
const INLINE_PICKER_SELECTOR = 'emoji-picker';
const POPUP_TRIGGER_SELECTOR = '[aria-expanded="true"][aria-haspopup]:not([aria-haspopup="false"])';
/** How long a popup gets to close on Escape before its trigger is pressed instead. */
export const POPUP_ESCAPE_MS = 80;

function isShown(el: HTMLElement): boolean {
  if (el.hidden || el.closest('[aria-hidden="true"], [inert]')) return false;
  // checkVisibility covers display:none / visibility:hidden ancestors (Chromium 105+, Safari
  // 17.4+); test DOMs without it count a connected, non-hidden element as shown.
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true })
    : true;
}

function lastShown(root: Document, selector: string): HTMLElement | null {
  const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
  for (let i = found.length - 1; i >= 0; i--) {
    const el = found[i];
    if (el && isShown(el)) return el;
  }
  return null;
}

/** The dialog Back should close: the last shown one in document order (portals append). */
export function topDialog(root: Document = document): HTMLElement | null {
  return lastShown(root, DIALOG_SELECTOR);
}

/** The trigger of the popup Back should close, if one is open. */
export function openPopupTrigger(root: Document = document): HTMLElement | null {
  return lastShown(root, POPUP_TRIGGER_SELECTOR);
}

function sendEscape(target: EventTarget): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
}

export type BackOutcome = 'closed-popup' | 'closed-dialog' | 'closed-actions' | 'background';

export function handleAndroidBack(
  moveToBackground: () => void,
  root: Document = document,
): BackOutcome {
  const trigger = openPopupTrigger(root);
  if (trigger) {
    const active = root.activeElement;
    sendEscape(active && active !== root.body ? active : trigger);
    // Pressing the trigger again is how a user closes a popup that ignores Escape. Only buttons:
    // pressing a text field (a combobox) would not close anything.
    setTimeout(() => {
      const isButton = trigger instanceof HTMLButtonElement || trigger.role === 'button';
      if (trigger.isConnected && trigger.getAttribute('aria-expanded') === 'true' && isButton) {
        trigger.click();
      }
    }, POPUP_ESCAPE_MS);
    return 'closed-popup';
  }
  const picker = lastShown(root, INLINE_PICKER_SELECTOR);
  if (picker) {
    sendEscape(picker);
    return 'closed-popup';
  }
  const dialog = topDialog(root);
  if (dialog) {
    // Dispatch from inside the dialog so element-level (React onKeyDown) and document-level
    // Escape handlers both see it.
    const active = root.activeElement;
    sendEscape(active && dialog.contains(active) ? active : dialog);
    return 'closed-dialog';
  }
  const openRows = root.querySelectorAll(`[${ACTIONS_OPEN_ATTR}]`);
  if (openRows.length > 0) {
    for (const row of openRows) row.removeAttribute(ACTIONS_OPEN_ATTR);
    return 'closed-actions';
  }
  moveToBackground();
  return 'background';
}
