import { getConnection } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import type { BleAdapterOwner } from '@/shared/electron-api.types';

import {
  acquireReticulumBleAdapter,
  getBleAdapterOwner,
  isNobleBleBlockedByReticulumLease,
  isReticulumBleBusyErrorMessage,
  releaseReticulumBleAdapter,
} from './reticulumBleAdapterLease';

export type { BleAdapterOwner };
export {
  acquireReticulumBleAdapter,
  getBleAdapterOwner,
  isNobleBleBlockedByReticulumLease,
  isReticulumBleBusyErrorMessage,
  releaseReticulumBleAdapter,
};

export interface ReticulumInterfaceBleRow {
  type: string;
  enabled: boolean;
  serial_port?: string | null;
}

/** BLE session statuses where the radio link is up or being established. */
const MESH_BLE_ACTIVE_STATUSES = new Set([
  'connecting',
  'connected',
  'configured',
  'reconnecting',
  'stale',
]);

/** True when any Meshtastic or MeshCore identity is on an active BLE connection. */
export function isMeshBleConnected(): boolean {
  const { identities } = useIdentityStore.getState();
  for (const identity of Object.values(identities)) {
    if (identity.protocol.type === 'reticulum') continue;
    const conn = getConnection(identity.id);
    if (conn?.connectionType !== 'ble') continue;
    if (MESH_BLE_ACTIVE_STATUSES.has(conn.status)) return true;
  }
  return false;
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

export function meshBleBlockedByReticulum(
  interfaces: readonly ReticulumInterfaceBleRow[],
): boolean {
  return hasEnabledReticulumBleInterface(interfaces);
}

export function reticulumBleBlockedByMesh(
  interfaces: readonly ReticulumInterfaceBleRow[],
): boolean {
  void interfaces;
  return isMeshBleConnected();
}
