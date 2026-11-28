/**
 * Message actions on touch screens.
 *
 * Desktop chat rows (ChatPanel, RoomsPanel, RrcChatView) show their actions (copy, reply, react,
 * star, translate, delete) on hover or keyboard focus: `opacity-0` with `group-hover...` and
 * `group-focus-within...` reveals. A touch screen has no hover, so on a phone they stayed
 * invisible while still taking width beside every message and still taking taps. mobileShell.css
 * keeps them out of layout and out of reach until a row is open; this module opens a row when the
 * message itself is tapped (not a control, not while text is selected) and closes it on a tap
 * anywhere else. Keyboard and screen-reader focus still reveal them through focus-within.
 */

export const ACTIONS_OPEN_ATTR = 'data-mobile-actions-open';

/** Elements the desktop reveals only on hover or focus (see the class lists named above). */
const HOVER_ONLY_ACTIONS =
  '.message-actions-bar.opacity-0, .opacity-0[class~="group-hover:opacity-100"]';

const CONTROL =
  'button, a[href], input, textarea, select, summary, label, [role="button"], [role="menuitem"], [role="option"], [contenteditable="true"]';

/** The nearest message row (a `group` / `group/msg` element) that holds hover-only actions. */
export function messageRowFor(el: Element | null): Element | null {
  for (let n = el; n; n = n.parentElement) {
    const cls = n.classList;
    if ((cls.contains('group/msg') || cls.contains('group')) && n.querySelector(HOVER_ONLY_ACTIONS))
      return n;
  }
  return null;
}

/** Apply one tap: open the tapped message's row, close every other open row. */
export function applyMessageTap(doc: Document, target: Element, selectedText: string): void {
  const row = messageRowFor(target);
  const onControl = target.closest(CONTROL) !== null;
  for (const open of doc.querySelectorAll(`[${ACTIONS_OPEN_ATTR}]`)) {
    if (open !== row) open.removeAttribute(ACTIONS_OPEN_ATTR);
  }
  // A control keeps its row as it is (pressing Copy leaves the actions up); a tap while text is
  // selected is part of selecting, not a request for the actions.
  if (!row || onControl || selectedText !== '') return;
  row.toggleAttribute(ACTIONS_OPEN_ATTR);
}

export function installTouchMessageActions(
  doc: Document = document,
  touchOnly: () => boolean = () => window.matchMedia('(hover: none)').matches,
): () => void {
  const onClick = (e: MouseEvent) => {
    if (!touchOnly() || !(e.target instanceof Element)) return;
    applyMessageTap(doc, e.target, doc.getSelection()?.toString() ?? '');
  };
  doc.addEventListener('click', onClick);
  return () => {
    doc.removeEventListener('click', onClick);
  };
}
