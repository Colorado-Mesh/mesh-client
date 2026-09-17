import type { BlePeripheralOwner } from '@/shared/electron-api.types';
import { normalizeBleMac } from '@/shared/normalizeBleMac';

export { normalizeBleMac };

/** Fired when Reticulum releases the BLE adapter lease so LoRa stacks can retry. */
export const BLE_ADAPTER_LEASE_RELEASED_EVENT = 'mesh-client:bleAdapterLeaseReleased';

export function dispatchBleAdapterLeaseReleased(): void {
  window.dispatchEvent(new CustomEvent(BLE_ADAPTER_LEASE_RELEASED_EVENT));
}

export function isBleScanBusyErrorMessage(message: string): boolean {
  return /Bluetooth scan in progress/i.test(message);
}

export function isBlePeripheralConflictErrorMessage(message: string): boolean {
  return /already in use by/i.test(message);
}

export async function acquireReticulumBleScan(): Promise<boolean> {
  try {
    const result = await window.electronAPI.bleCoexistence.acquireScan('reticulum');
    if (!result.ok) {
      console.debug('[Reticulum] bleCoexistence acquireScan busy:', result.owner);
      return false;
    }
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

/** Ensure sidecar is up for BLE RNode; does not tear down LoRa GATT sessions. */
export async function prepareReticulumBleRnodeConnect(): Promise<boolean> {
  try {
    // Scan lease only — LoRa GATT sessions stay up (single sidecar adapter owner).
    const result = await window.electronAPI.bleCoexistence.acquireScan('reticulum');
    if (!result.ok) {
      console.debug('[Reticulum] prepareReticulumBleRnodeConnect busy:', result.owner);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Reticulum] prepareReticulumBleRnodeConnect failed:', err);
    return false;
  }
}

export interface ReleaseReticulumBleRnodeConnectOptions {
  /**
   * Announce the release so Meshtastic/MeshCore retry. Pass false for steady-state cleanup
   * where no yield was actually held — repeat announcements reset their reconnect latches.
   */
  notify?: boolean;
}

export async function releaseReticulumBleRnodeConnect(
  options?: ReleaseReticulumBleRnodeConnectOptions,
): Promise<void> {
  await releaseReticulumBleScan();
  if (options?.notify ?? true) {
    dispatchBleAdapterLeaseReleased();
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
    case 'gatt:meshtastic':
      return 'connectionPanel.bleOwner.meshtastic';
    case 'gatt:meshcore':
      return 'connectionPanel.bleOwner.meshcore';
    case 'reticulum':
      return 'connectionPanel.bleOwner.reticulum';
    default:
      return null;
  }
}
