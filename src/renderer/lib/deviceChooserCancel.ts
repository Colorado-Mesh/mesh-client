/**
 * Web Serial and Web Bluetooth reject a dismissed device chooser with these messages (a
 * NotFoundError). Matched on the text because connection layers re-wrap the error and drop its
 * name.
 */
const CHOOSER_CANCEL_RE =
  /No port selected by the user|User cancelled the requestDevice\(\) chooser/i;

/** True when a connect failed only because the user closed the port or device chooser. */
export function isDeviceChooserCancel(err: unknown): boolean {
  const message =
    typeof err === 'string'
      ? err
      : typeof err === 'object' && err !== null && 'message' in err
        ? String(err.message)
        : '';
  return CHOOSER_CANCEL_RE.test(message);
}
