/** Shared BlueZ D-Bus error formatting (Linux BLE pairing helpers). */

import dbus from 'dbus-next';

export const BLUEZ_UNAVAILABLE_MESSAGE =
  'BlueZ D-Bus unavailable — ensure bluetoothd is running (systemctl status bluetooth)';

/** D-Bus error name from `DBusError.type`, else empty. */
export function dbusErrorType(err: unknown): string {
  if (err instanceof dbus.DBusError) return err.type;
  if (err && typeof err === 'object' && 'type' in err) {
    const type = (err as { type?: unknown }).type;
    return typeof type === 'string' ? type : '';
  }
  return '';
}

/**
 * Human-readable BlueZ / D-Bus failure text for IPC and logs.
 * Maps bus connectivity / ServiceUnknown to {@link BLUEZ_UNAVAILABLE_MESSAGE}.
 */
export function formatBluezError(err: unknown): string {
  const type = dbusErrorType(err);
  if (/ServiceUnknown|NameHasNoOwner/i.test(type)) {
    return BLUEZ_UNAVAILABLE_MESSAGE;
  }
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

/**
 * True when a D-Bus error should be treated as already-in-progress / already-exists
 * (StartDiscovery / RegisterAgent). Prefers `err.type`, falls back to message text.
 */
export function isBluezAlreadyExistsOrInProgress(err: unknown): boolean {
  const type = dbusErrorType(err);
  if (/InProgress|AlreadyExists/i.test(type)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /InProgress|AlreadyExists/i.test(msg);
}
