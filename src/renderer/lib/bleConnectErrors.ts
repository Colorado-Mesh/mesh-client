export type MeshcoreBleTimeoutStage = 'ipc-open' | 'protocol-handshake' | 'unknown';

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

export function isMeshcoreRetryableBleErrorMessage(message: string): boolean {
  if (classifyMeshcoreBleTimeoutStage(message) !== 'unknown') return true;
  return /already in progress|gatt server is disconnected|disconnected during gatt init/i.test(
    message,
  );
}
