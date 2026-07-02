import type { BlePeripheralOwner, NobleBleSessionId } from '@/shared/electron-api.types';

export function webBtOwnerForSession(sessionId: NobleBleSessionId): BlePeripheralOwner {
  return sessionId === 'meshcore' ? 'webbt:meshcore' : 'webbt:meshtastic';
}

export async function acquireWebBtScanLease(): Promise<boolean> {
  try {
    await window.electronAPI.bleCoexistence.acquireScan('webbt');
    return true;
  } catch (err) {
    console.warn('[WebBluetooth] bleCoexistence acquireScan failed:', err);
    return false;
  }
}

export async function releaseWebBtScanLease(): Promise<void> {
  try {
    await window.electronAPI.bleCoexistence.releaseScan('webbt');
  } catch (err) {
    console.warn('[WebBluetooth] bleCoexistence releaseScan failed:', err);
  }
}

export async function assertWebBtCanConnect(
  sessionId: NobleBleSessionId,
  deviceId: string,
): Promise<void> {
  await window.electronAPI.bleCoexistence.assertCanConnect(
    webBtOwnerForSession(sessionId),
    deviceId,
  );
}

export async function registerWebBtDevice(
  sessionId: NobleBleSessionId,
  deviceId: string,
): Promise<void> {
  await window.electronAPI.bleCoexistence.register(deviceId, webBtOwnerForSession(sessionId));
}

export async function unregisterWebBtDevice(
  sessionId: NobleBleSessionId,
  deviceId: string,
): Promise<void> {
  await window.electronAPI.bleCoexistence.unregister(deviceId, webBtOwnerForSession(sessionId));
}
