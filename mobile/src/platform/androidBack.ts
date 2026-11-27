/**
 * Android system Back (button or gesture). The desktop renderer has no Back: its sheets and
 * dialogs close on Escape. Back closes the topmost open dialog by sending it Escape; with no
 * dialog open it moves the app to the background (the Android convention at a root screen),
 * which keeps radio connections running instead of finishing the activity.
 */

const DIALOG_SELECTOR = '[aria-modal="true"], [role="dialog"], [role="alertdialog"]';

function isShown(el: HTMLElement): boolean {
  if (el.hidden || el.closest('[aria-hidden="true"], [inert]')) return false;
  // checkVisibility covers display:none / visibility:hidden ancestors (Chromium 105+, Safari
  // 17.4+); test DOMs without it count a connected, non-hidden dialog as shown.
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true })
    : true;
}

/** The dialog Back should close: the last shown one in document order (portals append). */
export function topDialog(root: Document = document): HTMLElement | null {
  const dialogs = Array.from(root.querySelectorAll<HTMLElement>(DIALOG_SELECTOR));
  for (let i = dialogs.length - 1; i >= 0; i--) {
    const d = dialogs[i];
    if (d && isShown(d)) return d;
  }
  return null;
}

export type BackOutcome = 'closed-dialog' | 'background';

export function handleAndroidBack(
  moveToBackground: () => void,
  root: Document = document,
): BackOutcome {
  const dialog = topDialog(root);
  if (dialog) {
    // Dispatch from inside the dialog so element-level (React onKeyDown) and document-level
    // Escape handlers both see it.
    const active = root.activeElement;
    const target = active && dialog.contains(active) ? active : dialog;
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    return 'closed-dialog';
  }
  moveToBackground();
  return 'background';
}
