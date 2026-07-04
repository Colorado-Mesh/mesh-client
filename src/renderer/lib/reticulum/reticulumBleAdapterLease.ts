import type { BlePeripheralOwner } from '@/shared/electron-api.types';
import { normalizeBleMac } from '@/shared/normalizeBleMac';

export { normalizeBleMac };

export function isBleScanBusyErrorMessage(message: string): boolean {
  return /Bluetooth scan in progress/i.test(message);
}

export function isBlePeripheralConflictErrorMessage(message: string): boolean {
  return /already in use by/i.test(message);
}

/** @deprecated Use isBleScanBusyErrorMessage or isBlePeripheralConflictErrorMessage. */
export function isReticulumBleBusyErrorMessage(message: string): boolean {
  return isBleScanBusyErrorMessage(message) || isBlePeripheralConflictErrorMessage(message);
}

export async function acquireReticulumBleScan(): Promise<boolean> {
  try {
    await window.electronAPI.bleCoexistence.acquireScan('reticulum');
    return true;
  } catch (err) {
    console.warn('[Reticulum] bleCoexistence acquireScan failed:', err);
    return false;
  }
}

export async function releaseReticulumBleScan(): Promise<void> {
  try {
    await window.electronAPI.bleCoexistence.releaseScan('reticulum');
  } catch (err) {
    console.warn('[Reticulum] bleCoexistence releaseScan failed:', err);
  }
}

export async function registerReticulumBleMac(mac: string): Promise<boolean> {
  try {
    await window.electronAPI.bleCoexistence.register(mac, 'reticulum');
    return true;
  } catch (err) {
    console.warn('[Reticulum] bleCoexistence register failed:', err);
    return false;
  }
}

export async function unregisterReticulumBleMac(mac: string): Promise<void> {
  try {
    await window.electronAPI.bleCoexistence.unregister(mac, 'reticulum');
  } catch (err) {
    console.warn('[Reticulum] bleCoexistence unregister failed:', err);
  }
}

export function parseBleMacFromReticulumSerialPort(serialPort: string): string | null {
  if (!serialPort.startsWith('ble://')) return null;
  const mac = serialPort.slice('ble://'.length).trim();
  return mac.length > 0 ? mac : null;
}

export function bleOwnerI18nKey(owner: BlePeripheralOwner): string | null {
  switch (owner) {
    case 'noble:meshtastic':
    case 'webbt:meshtastic':
      return 'connectionPanel.bleOwner.meshtastic';
    case 'noble:meshcore':
    case 'webbt:meshcore':
      return 'connectionPanel.bleOwner.meshcore';
    case 'reticulum':
      return 'connectionPanel.bleOwner.reticulum';
    default:
      return null;
  }
}

/** English fallback for logs/tests; UI should use bleOwnerI18nKey + t(). */
export function reticulumOwnerLabel(owner: BlePeripheralOwner): string {
  switch (owner) {
    case 'noble:meshtastic':
    case 'webbt:meshtastic':
      return 'Meshtastic';
    case 'noble:meshcore':
    case 'webbt:meshcore':
      return 'MeshCore';
    case 'reticulum':
      return 'Reticulum';
    default:
      return owner;
  }
}
