/**
 * Marks an overlay that must keep the keyboard while it is open, above any modal under it (the
 * incoming-call ring). Put it on the overlay's root element.
 */
export const KEYBOARD_OWNER_ATTRIBUTE = 'data-keyboard-owner';

const OWNER_CONTROLS =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function topOwner(doc: Document): HTMLElement | undefined {
  return [...doc.querySelectorAll<HTMLElement>(`[${KEYBOARD_OWNER_ATTRIBUTE}]`)].at(-1);
}

/**
 * While an element with `KEYBOARD_OWNER_ATTRIBUTE` is in the document:
 * - Tab and Shift+Tab cycle that element's controls (entering it from anywhere), and Escape does
 *   nothing. Enter, Space and every other key pass through.
 * - Focus that lands outside it goes back to the element inside it that last had focus (or its
 *   `tabindex="-1"` panel, else its first control), so Enter or Space never reach a control the
 *   owner covers.
 * With no owner in the document both listeners return at once.
 *
 * Modals here trap Tab and handle Escape with their own window or document listeners, and some
 * refocus themselves when their parent re-renders (ConfirmModal). The key listener stops the
 * former, so the guard must be installed before any component mounts (renderer entry), which puts
 * it first among window capture listeners.
 */
export function installKeyboardOwnerGuard(target: Window = window): () => void {
  let lastInside: HTMLElement | null = null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' && event.key !== 'Escape') return;
    const owner = topOwner(target.document);
    if (!owner) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape') return;

    const controls = [...owner.querySelectorAll<HTMLElement>(OWNER_CONTROLS)];
    if (controls.length === 0) {
      owner.focus();
      return;
    }
    const active = target.document.activeElement;
    const index = controls.findIndex((control) => control === active);
    const last = controls.length - 1;
    let next: number;
    if (event.shiftKey) next = index <= 0 ? last : index - 1;
    else next = index === -1 || index === last ? 0 : index + 1;
    controls[next].focus();
  };

  const onFocusIn = (event: FocusEvent) => {
    const owner = topOwner(target.document);
    if (!owner) {
      lastInside = null;
      return;
    }
    const focused = event.target;
    if (focused instanceof Node && owner.contains(focused)) {
      lastInside = focused instanceof HTMLElement ? focused : null;
      return;
    }
    const back =
      (lastInside && owner.contains(lastInside) ? lastInside : null) ??
      owner.querySelector<HTMLElement>('[tabindex="-1"]') ??
      owner.querySelector<HTMLElement>(OWNER_CONTROLS) ??
      owner;
    back.focus();
  };

  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('focusin', onFocusIn, true);
  return () => {
    target.removeEventListener('keydown', onKeyDown, true);
    target.removeEventListener('focusin', onFocusIn, true);
  };
}
