/** Shared BlueZ D-Bus error formatting (Linux BLE pairing helpers). */

export const BLUEZ_UNAVAILABLE_MESSAGE =
  'BlueZ D-Bus unavailable — ensure bluetoothd is running (systemctl status bluetooth)';

export function formatBluezError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message;
    if (
      /ECONNREFUSED|ENOENT|No such file|connect ENOENT|Failed to connect|org\.freedesktop\.DBus\.Error\.ServiceUnknown|Name has no owner/i.test(
        msg,
      )
    ) {
      return BLUEZ_UNAVAILABLE_MESSAGE;
    }
    return msg;
  }
  return String(err);
}
