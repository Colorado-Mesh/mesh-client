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
  const onClick = (e: MouseEvent) => {
    // A held tap passed on below is not trusted, so it reaches the trigger.
    if (!touchOnly() || !isUserTap(e) || !(e.target instanceof Element)) return;
    const field = doc.activeElement;
    if (!(field instanceof HTMLElement) || !field.matches(TEXT_FIELD)) return;
    const trigger = e.target.closest<HTMLElement>(POPUP_TRIGGER);
    // Only buttons: click() on a combobox field would not focus it or reach what was tapped.
    const isButton =
      trigger instanceof HTMLButtonElement || trigger?.getAttribute('role') === 'button';
    if (!trigger || !isButton || trigger.contains(field)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    let passed = false;
    let resized = false;
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
    field.blur();
  };
  // Capture on the document: ahead of React's listeners on its root.
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
  };
}
