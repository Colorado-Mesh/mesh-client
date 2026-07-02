import type { BlePeripheralOwner } from '@/shared/electron-api.types';

import {
  acquireReticulumBleScan,
  isBlePeripheralConflictErrorMessage,
  isBleScanBusyErrorMessage,
  normalizeBleMac,
  parseBleMacFromReticulumSerialPort,
  registerReticulumBleMac,
  releaseReticulumBleScan,
  unregisterReticulumBleMac,
} from './reticulumBleAdapterLease';

export type { BlePeripheralOwner };
export {
  acquireReticulumBleScan,
  isBlePeripheralConflictErrorMessage,
  isBleScanBusyErrorMessage,
  parseBleMacFromReticulumSerialPort,
  registerReticulumBleMac,
  releaseReticulumBleScan,
  unregisterReticulumBleMac,
};

export interface ReticulumInterfaceBleRow {
  type: string;
  enabled: boolean;
  serial_port?: string | null;
  seed_addresses?: string[] | null;
}

export function isReticulumBleInterfaceRow(row: ReticulumInterfaceBleRow): boolean {
  const normalized = row.type.toLowerCase();
  if (normalized === 'ble_peer' || normalized.includes('blepeer')) return true;
  return (
    normalized === 'rnode' &&
    typeof row.serial_port === 'string' &&
    row.serial_port.startsWith('ble://')
  );
}

export function hasEnabledReticulumBleInterface(
  interfaces: readonly ReticulumInterfaceBleRow[],
): boolean {
  return interfaces.some((iface) => iface.enabled && isReticulumBleInterfaceRow(iface));
}

/** Collect BLE MACs from enabled Reticulum interface rows (RNode ble:// URIs and ble_peer seeds). */
export function collectReticulumBleMacs(row: ReticulumInterfaceBleRow): string[] {
  const macs: string[] = [];
  if (typeof row.serial_port === 'string') {
    const fromSerial = parseBleMacFromReticulumSerialPort(row.serial_port);
    if (fromSerial) macs.push(fromSerial);
  }
  if (Array.isArray(row.seed_addresses)) {
    for (const seed of row.seed_addresses) {
      if (typeof seed === 'string' && seed.trim().length > 0) {
        macs.push(seed.trim());
      }
    }
  }
  return macs;
}

/** Register known Reticulum BLE MACs from interface config with the coexistence coordinator. */
export async function syncReticulumBleRegistry(
  interfaces: readonly ReticulumInterfaceBleRow[],
): Promise<void> {
  const state = await window.electronAPI.bleCoexistence.getState();
  const registeredReticulum = new Set(
    state.connections.filter((c) => c.owner === 'reticulum').map((c) => c.mac),
  );
  const desired = new Set<string>();
  for (const row of interfaces) {
    if (!row.enabled || !isReticulumBleInterfaceRow(row)) continue;
    for (const mac of collectReticulumBleMacs(row)) {
      desired.add(normalizeBleMac(mac));
    }
  }
  for (const mac of desired) {
    if (!registeredReticulum.has(mac)) {
      await registerReticulumBleMac(mac);
    }
  }
  for (const mac of registeredReticulum) {
    if (!desired.has(mac)) {
      await unregisterReticulumBleMac(mac);
    }
  }
}
