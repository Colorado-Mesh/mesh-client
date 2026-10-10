import type { BlePeripheralOwner } from '@/shared/electron-api.types';
import { normalizeBleMac } from '@/shared/normalizeBleMac';

export { normalizeBleMac };

/** Fired when the BLE adapter lease is released so LoRa stacks can retry. */
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

export function bleOwnerI18nKey(owner: BlePeripheralOwner): string | null {
  switch (owner) {
    case 'gatt:meshtastic':
      return 'connectionPanel.bleOwner.meshtastic';
    case 'gatt:meshcore':
      return 'connectionPanel.bleOwner.meshcore';
    default:
      return null;
  }
}
