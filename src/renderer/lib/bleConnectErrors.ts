export type MeshcoreBleTimeoutStage = 'ipc-open' | 'protocol-handshake' | 'unknown';

/** DOMException.message when user disconnects while MeshCore `initConn` is still running. */
export const MESHCORE_SETUP_ABORT_MESSAGE = 'MeshCore connection setup cancelled';

const MAIN_PROCESS_BLE_TIMEOUT_RE =
  /BLE connectAsync timed out|BLE characteristic discovery timed out|BLE fromNum subscribe timed out|BLE fromRadio subscribe timed out/i;

export function isMainProcessBleTimeoutMessage(message: string): boolean {
  return MAIN_PROCESS_BLE_TIMEOUT_RE.test(message);
}

export function classifyMeshcoreBleTimeoutStage(message: string): MeshcoreBleTimeoutStage {
  if (/MeshCore BLE IPC open timed out/i.test(message)) return 'ipc-open';
  if (/MeshCore BLE protocol handshake timed out/i.test(message)) return 'protocol-handshake';
  if (isMainProcessBleTimeoutMessage(message)) return 'ipc-open';
  return 'unknown';
}

/** WinRT / BlueZ sometimes drop the link during GATT service or characteristic discovery. */
const MESHCORE_RETRYABLE_GATT_DISCOVERY_FLAKES_RE =
  /unreachable while discovering services|unreachable while discovering characteristics|gatt.*unreachable/i;

export function isMeshcoreRetryableBleErrorMessage(message: string): boolean {
  if (classifyMeshcoreBleTimeoutStage(message) !== 'unknown') return true;
  if (MESHCORE_RETRYABLE_GATT_DISCOVERY_FLAKES_RE.test(message)) return true;
  return /already in progress|gatt server is disconnected|disconnected during gatt init|fromRadio characteristic supports neither notify nor read/i.test(
    message,
  );
}

// ─── Web Bluetooth (Linux) error detection ───────────────────────────────────

/**
 * BlueZ error patterns that indicate pairing/authentication failures on Linux.
 * These appear in DOMException.message when Chrome/Chromium communicates with BlueZ.
 */
const BLUEZ_PAIRING_ERROR_RE =
  /le-connection-abort-by-local|auth failed|connection rejected|pin failed|authentication failed|org\.bluez\.Error/i;

/**
 * Chrome DOMException error.name values that often indicate pairing issues on Linux.
 * - SecurityError: Authentication failure, permission denied
 * - NetworkError: Connection attempt failed (includes BlueZ pairing failures)
 */
const CHROME_PAIRING_ERROR_NAMES = ['SecurityError', 'NetworkError'];

/**
 * Check if a DOMException from Web Bluetooth is likely a pairing-related error.
 * On Linux with BlueZ, pairing failures surface as generic NetworkError or SecurityError.
 */
export function isWebBluetoothPairingError(err: unknown): boolean {
  if (err instanceof DOMException) {
    if (CHROME_PAIRING_ERROR_NAMES.includes(err.name)) {
      return true;
    }
    if (BLUEZ_PAIRING_ERROR_RE.test(err.message)) {
      return true;
    }
  }
  if (err instanceof Error) {
    if (err.message.includes('GATT Error: Not supported')) {
      return true;
    }
    if (BLUEZ_PAIRING_ERROR_RE.test(err.message)) {
      return true;
    }
  }
  return false;
}
