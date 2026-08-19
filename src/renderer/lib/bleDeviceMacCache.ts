import { isTwelveHexBleMac, normalizeBleMac } from '@/shared/normalizeBleMac';

import { cacheTransportDisplayName } from './meshtastic/transportDisplayNameCache';
import { parseStoredJson } from './parseStoredJson';

export const BLE_DEVICE_MACS_KEY = 'mesh-client:bleDeviceMacs';

/** Persist UUID → MAC so later scans can show the sticker address when Noble `address` is empty. */
export function cacheBleDeviceMac(deviceId: string, address: string): void {
  const id = deviceId.trim();
  const mac = address.trim();
  if (!id || !isTwelveHexBleMac(mac)) return;
  if (isTwelveHexBleMac(id)) return;
  cacheTransportDisplayName(BLE_DEVICE_MACS_KEY, id, normalizeBleMac(mac));
}

export function loadBleDeviceMacCache(): Record<string, string> {
  return (
    parseStoredJson<Record<string, string>>(
      localStorage.getItem(BLE_DEVICE_MACS_KEY),
      'bleDeviceMacCache',
    ) ?? {}
  );
}

export function getBleDeviceMac(deviceId: string): string | null {
  const id = deviceId.trim();
  if (!id) return null;
  return loadBleDeviceMacCache()[id] ?? null;
}
