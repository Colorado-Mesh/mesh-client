/**
 * Web Serial rejects a dismissed port chooser with a NotFoundError. Match the text because
 * connection layers re-wrap the error and drop its name.
 */
const CHOOSER_CANCEL_RE = /No port selected by the user/i;

/** True when a connect failed only because the user closed the serial port chooser. */
export function isDeviceChooserCancel(err: unknown): boolean {
  const message =
    typeof err === 'string'
      ? err
      : typeof err === 'object' && err !== null && 'message' in err
        ? String(err.message)
        : '';
  return CHOOSER_CANCEL_RE.test(message);
}
