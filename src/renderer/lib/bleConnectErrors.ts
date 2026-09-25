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

/** Stable sidecar GATT error codes → `connectionPanel.errors.ble.*`. */
export const GATT_BLE_ERROR_CODES = [
  'adapter_missing',
  'permission_denied',
  'scan_busy',
  'mac_conflict',
  'connect_timeout',
  'gatt_discover_failed',
  'pairing_required',
  'bond_removed',
  'write_failed',
  'session_not_found',
  'notified_read_forbidden',
  'feature_disabled',
  'sidecar_down',
] as const;

export type GattBleErrorCode = (typeof GATT_BLE_ERROR_CODES)[number];

const GATT_BLE_ERROR_CODE_SET = new Set<string>(GATT_BLE_ERROR_CODES);

export function isGattBleErrorCode(code: string): code is GattBleErrorCode {
  return GATT_BLE_ERROR_CODE_SET.has(code);
}

export function gattBleErrorI18nKey(
  code: string,
): `connectionPanel.errors.ble.${GattBleErrorCode}` | null {
  if (!isGattBleErrorCode(code)) return null;
  return `connectionPanel.errors.ble.${code}`;
}

/**
 * Extract a stable GATT error code from IPC `{ code }` shapes or `code: message` strings.
 */
export function extractGattBleErrorCode(err: unknown): GattBleErrorCode | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = err.code;
    if (typeof code === 'string' && isGattBleErrorCode(code)) return code;
  }
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!msg) return null;
  if (isGattBleErrorCode(msg)) return msg;
  const prefixed = /^([a-z_]+)\s*:/.exec(msg);
  if (prefixed?.[1] && isGattBleErrorCode(prefixed[1])) return prefixed[1];
  if (/gatt sidecar ensure not configured|sidecar.*(down|not running|failed to start)/i.test(msg)) {
    return 'sidecar_down';
  }
  return null;
}

/** BlueZ / OS pairing patterns that may still appear in adapter logs. */
const BLUEZ_PAIRING_ERROR_RE =
  /le-connection-abort-by-local|auth failed|connection rejected|pin failed|authentication failed|org\.bluez\.Error/i;

const CHROME_PAIRING_ERROR_NAMES = new Set(['SecurityError', 'NetworkError']);

/** True when an error looks like OS-level BLE pairing/auth failure. */
export function isBlePairingError(err: unknown): boolean {
  if (extractGattBleErrorCode(err) === 'pairing_required') return true;
  if (err instanceof DOMException) {
    if (CHROME_PAIRING_ERROR_NAMES.has(err.name)) return true;
    if (BLUEZ_PAIRING_ERROR_RE.test(err.message)) return true;
  }
  if (err instanceof Error) {
    if (err.message.includes('GATT Error: Not supported')) return true;
    if (BLUEZ_PAIRING_ERROR_RE.test(err.message)) return true;
  }
  return false;
}
