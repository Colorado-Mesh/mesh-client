/**
 * Android keeps the soft keyboard up when the focused field disappears (the More sheet closing
 * after a search result is picked, a dialog unmounting) and focus falls back to `<body>`: the
 * keyboard then covers half the screen with nothing to type into. Chromium does not fire `blur`
 * when a focused element is removed, so while the keyboard is up this guard also watches DOM
 * changes, and hides the keyboard once no editable element holds focus.
 */

/** True for elements that legitimately keep the soft keyboard open. */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const nonText = ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'];
    return !nonText.includes(el.type) && !el.readOnly && !el.disabled;
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/** How long focus may take to land on a new field before the keyboard is hidden. */
export const SETTLE_MS = 250;

export interface KeyboardFocusGuard {
  /** The native keyboard opened (start watching) or closed (stop). */
  setKeyboardOpen(open: boolean): void;
  dispose(): void;
}

export function createKeyboardFocusGuard(hideKeyboard: () => void): KeyboardFocusGuard {
  let open = false;
  let pending = false;
  const check = () => {
    pending = false;
    if (open && !isEditable(document.activeElement)) hideKeyboard();
  };
  // Focus often lands on the next field a moment later (a settings search result scrolls to its
  // setting, then focuses it); checking at once hid the keyboard and Android raised it again 5 ms
  // later. One check per burst, a fixed delay after the first change, so a stream of DOM updates
  // cannot postpone it.
  const schedule = () => {
    if (pending || !open) return;
    pending = true;
    setTimeout(check, SETTLE_MS);
  };
  const observer = new MutationObserver(schedule);
  const onFocusOut = () => {
    schedule();
  };
  return {
    setKeyboardOpen(next) {
      if (next === open) return;
      open = next;
      if (open) {
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener('focusout', onFocusOut, true);
      } else {
        observer.disconnect();
        document.removeEventListener('focusout', onFocusOut, true);
      }
    },
    dispose() {
      this.setKeyboardOpen(false);
    },
  };
}
