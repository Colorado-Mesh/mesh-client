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
