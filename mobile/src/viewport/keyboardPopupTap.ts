/**
 * Touch screens: a tap on a popup trigger (a button with `aria-haspopup`, such as the composer's
 * Send options and More macros menus) while a text field has focus. Opening the popup moves focus
 * off the field, the keyboard closes, and on Android that resizes the window; popups that close on
 * resize so they do not drift from their trigger then shut about 90 ms after opening, so the tap
 * seemed to do nothing. The chat list also scrolls as it re-anchors after the resize, which closes
 * the same popups. The tap is held until the keyboard has closed (the window's resize, or
 * KEYBOARD_SETTLE_MS when none comes, as with a hardware keyboard) and the page has then been still
 * for LAYOUT_QUIET_MS, and is then passed to the trigger; never longer than MAX_HOLD_MS.
 */

/** Longest wait for the keyboard's resize before the held tap is passed on. */
export const KEYBOARD_SETTLE_MS = 400;
/** After the resize, how long the page must go without a resize or scroll. */
export const LAYOUT_QUIET_MS = 150;
/** The tap is passed on by this time whatever the page is doing. */
export const MAX_HOLD_MS = 1000;

const TEXT_FIELD =
  'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], ' +
  'input[type="url"], input[type="tel"], input[type="number"], input[type="password"], ' +
  '[contenteditable=""], [contenteditable="true"]';
const POPUP_TRIGGER = '[aria-haspopup]:not([aria-haspopup="false"])';

export function installKeyboardPopupTap(
  doc: Document = document,
  touchOnly: () => boolean = () => window.matchMedia('(hover: none)').matches,
  isUserTap: (e: MouseEvent) => boolean = (e) => e.isTrusted,
): () => void {
  const view = doc.defaultView ?? window;
  const focusedField = (): HTMLElement | null => {
    const field = doc.activeElement;
    return field instanceof HTMLElement && field.matches(TEXT_FIELD) ? field : null;
  };
  const popupButton = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const trigger = target.closest<HTMLElement>(POPUP_TRIGGER);
    // Only buttons: click() on a combobox field would not focus it or reach what was tapped.
    const isButton =
      trigger instanceof HTMLButtonElement || trigger?.getAttribute('role') === 'button';
    // A tap on a trigger whose popup is open closes it; nothing to protect, and holding it lets a
    // popup that closed on the keyboard's resize open again (the Area picker's own search field).
    const opening = trigger?.getAttribute('aria-expanded') !== 'true';
    return trigger && isButton && opening ? trigger : null;
  };
  // Most buttons take focus when pressed, so by the click the field has already lost it (and the
  // keyboard is closing). Note at pointerdown that the press began while typing, and whether the
  // window resized before the click.
  let pressed: { trigger: HTMLElement; resized: boolean } | null = null;
  const onPointerDown = (e: Event) => {
    pressed = null;
    if (!touchOnly()) return;
    const field = focusedField();
    const trigger = popupButton(e.target);
    if (field && trigger && !trigger.contains(field)) pressed = { trigger, resized: false };
  };
  const onWindowResize = () => {
    if (pressed) pressed.resized = true;
  };
  const onClick = (e: MouseEvent) => {
    // A held tap passed on below is not trusted, so it reaches the trigger.
    if (!touchOnly() || !isUserTap(e)) return;
    const press = pressed;
    pressed = null;
    const trigger = popupButton(e.target);
    if (!trigger) return;
    const field = focusedField();
    const typing = press?.trigger === trigger || (field !== null && !trigger.contains(field));
    if (!typing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    let passed = false;
    let resized = press?.resized ?? false;
    let quiet = 0;
    const pass = () => {
      if (passed) return;
      passed = true;
      view.removeEventListener('resize', onResize);
      doc.removeEventListener('scroll', onScroll, true);
      view.clearTimeout(noResize);
      view.clearTimeout(quiet);
      view.clearTimeout(limit);
      if (trigger.isConnected) trigger.click();
    };
    const waitForQuiet = () => {
      view.clearTimeout(quiet);
      quiet = view.setTimeout(pass, LAYOUT_QUIET_MS);
    };
    const onResize = () => {
      resized = true;
      view.clearTimeout(noResize);
      waitForQuiet();
    };
    const onScroll = () => {
      if (resized) waitForQuiet();
    };
    const noResize = view.setTimeout(pass, KEYBOARD_SETTLE_MS);
    const limit = view.setTimeout(pass, MAX_HOLD_MS);
    view.addEventListener('resize', onResize);
    doc.addEventListener('scroll', onScroll, true);
    // The keyboard already closed between the press and the click: wait for the page to settle.
    if (resized) onResize();
    field?.blur();
  };
  // Capture on the document: ahead of React's listeners on its root.
  doc.addEventListener('pointerdown', onPointerDown, true);
  view.addEventListener('resize', onWindowResize);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true);
    view.removeEventListener('resize', onWindowResize);
    doc.removeEventListener('click', onClick, true);
  };
}
