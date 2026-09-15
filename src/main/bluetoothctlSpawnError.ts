/** Shared bluetoothctl spawn error formatting (Linux BlueZ pairing helpers). */

export const BLUETOOTHCTL_NOT_FOUND_MESSAGE =
  'bluetoothctl not found — install bluez (e.g. apt install bluez) to pair from the app';

export function formatBluetoothctlSpawnError(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: string }).code === 'ENOENT'
  ) {
    return BLUETOOTHCTL_NOT_FOUND_MESSAGE;
  }
  if (err instanceof Error) {
    if (/ENOENT|spawn bluetoothctl/i.test(err.message)) {
      return BLUETOOTHCTL_NOT_FOUND_MESSAGE;
    }
    return err.message;
  }
  return String(err);
}
