/**
 * Soft keyboard rules for the Android WebView:
 *
 * - The keyboard shows only for a field the user touched. The desktop renderer moves the caret
 *   into a field after keyboard-friendly actions (picking a channel focuses the composer, a
 *   settings search result focuses its field), and on Android a programmatic `focus()` raises the
 *   keyboard over the conversation. WKWebView already works this way (keyboard only after a tap),
 *   so the two platforms now agree. The caret stays; tapping the field brings the keyboard.
 * - Android keeps the keyboard up when the focused field disappears (the More sheet closing after
 *   a search result is picked, a dialog unmounting) and focus falls back to `<body>`. Chromium does
 *   not fire `blur` when a focused element is removed, so while the keyboard is up this guard also
 *   watches DOM changes, and hides the keyboard once no editable element holds focus.
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

/** A keyboard that opens within this long of a touch on its field counts as asked for. */
export const TOUCH_WINDOW_MS = 1_500;

/** The touch landed on the field, inside it, or on a label for it. */
function touchedField(target: EventTarget | null, field: Element): boolean {
  if (!(target instanceof Node)) return false;
  if (field === target || field.contains(target)) return true;
  const label = target instanceof Element ? target.closest('label') : null;
  return label?.control === field;
}

export interface KeyboardFocusGuard {
  /** The native keyboard opened (start watching) or closed (stop). */
  setKeyboardOpen(open: boolean): void;
  dispose(): void;
}

export function createKeyboardFocusGuard(
  hideKeyboard: () => void,
  now: () => number = Date.now,
): KeyboardFocusGuard {
  let open = false;
  let pending = false;
  let lastTouch: { target: EventTarget | null; at: number } = { target: null, at: -Infinity };
  const onPointerDown = (e: PointerEvent) => {
    lastTouch = { target: e.target, at: now() };
  };
  document.addEventListener('pointerdown', onPointerDown, true);
  const askedFor = (field: Element) =>
    now() - lastTouch.at <= TOUCH_WINDOW_MS && touchedField(lastTouch.target, field);
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
        // Raised by a programmatic focus, not a touch on the field: put it away, keep the caret.
        const active = document.activeElement;
        if (active && isEditable(active) && !askedFor(active)) hideKeyboard();
      } else {
        observer.disconnect();
        document.removeEventListener('focusout', onFocusOut, true);
      }
    },
    dispose() {
      this.setKeyboardOpen(false);
      document.removeEventListener('pointerdown', onPointerDown, true);
    },
  };
}
