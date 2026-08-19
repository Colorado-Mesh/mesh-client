export type MeshcoreBleTimeoutStage = 'ipc-open' | 'protocol-handshake' | 'unknown';

/** DOMException.message when user disconnects while MeshCore `initConn` is still running. */
export const MESHCORE_SETUP_ABORT_MESSAGE = 'MeshCore connection setup cancelled';

/** True when MeshCore RF setup was superseded (disconnect / new connect bumped setup generation). */
export function isMeshcoreSetupAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    err.name === 'AbortError' &&
    err.message === MESHCORE_SETUP_ABORT_MESSAGE
  );
}

/** Main-process MeshCore TCP bridge has no live socket (peer FIN / local teardown). */
const MESHCORE_TCP_TRANSPORT_DEAD_RE =
  /meshcore:tcp-write:\s*no active socket|Error invoking remote method 'meshcore:tcp-write'/i;

/**
 * True when a MeshCore companion RPC failed because the TCP IPC bridge is already down.
 * Used to hard-abort `initConn` instead of soft-catching into a false `configured` session
 * (n7eal: peer FIN after getContacts → write storm).
 */
export function isMeshcoreTcpTransportDeadError(err: unknown): boolean {
  if (err instanceof Error) {
    return MESHCORE_TCP_TRANSPORT_DEAD_RE.test(err.message);
  }
  if (typeof err === 'string') {
    return MESHCORE_TCP_TRANSPORT_DEAD_RE.test(err);
  }
  return false;
}

/** Convert TCP-bridge death into the standard setup AbortError (or rethrow if already abort). */
export function rethrowMeshcoreSetupAbortFromTcpDead(err: unknown): void {
  if (isMeshcoreSetupAbortError(err)) throw err;
  if (isMeshcoreTcpTransportDeadError(err)) {
    throw new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
  }
}

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

const MESHCORE_MISSING_SERVICES_RE =
  /could not find all requested services|failed to find required ble characteristics/i;

export function isMeshcoreMissingServicesErrorMessage(message: string): boolean {
  return MESHCORE_MISSING_SERVICES_RE.test(message);
}

export function shouldClearMeshcoreBleSelectionForError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isMeshcoreMissingServicesErrorMessage(message) ||
    message === 'meshcore.errors.bleMissingServices'
  );
}

/** WinRT / BlueZ sometimes drop the link during GATT service or characteristic discovery. */
const MESHCORE_RETRYABLE_GATT_DISCOVERY_FLAKES_RE =
  /unreachable while discovering services|unreachable while discovering characteristics|gatt.*unreachable/i;

export function isMeshcoreRetryableBleErrorMessage(message: string): boolean {
  if (classifyMeshcoreBleTimeoutStage(message) !== 'unknown') return true;
  if (MESHCORE_RETRYABLE_GATT_DISCOVERY_FLAKES_RE.test(message)) return true;
  return /already in progress|gatt server is disconnected|disconnected during gatt init|disconnected during handshake|pairing step finished|fromRadio characteristic supports neither notify nor read/i.test(
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
const CHROME_PAIRING_ERROR_NAMES = new Set(['SecurityError', 'NetworkError']);

/**
 * Check if a DOMException from Web Bluetooth is likely a pairing-related error.
 * On Linux with BlueZ, pairing failures surface as generic NetworkError or SecurityError.
 */
export function isWebBluetoothPairingError(err: unknown): boolean {
  if (err instanceof DOMException) {
    if (CHROME_PAIRING_ERROR_NAMES.has(err.name)) {
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
