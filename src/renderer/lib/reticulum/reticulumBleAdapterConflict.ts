import { getConnection } from '@/renderer/stores/connectionStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import type { BleAdapterOwner } from '@/shared/electron-api.types';

export interface ReticulumInterfaceBleRow {
  type: string;
  enabled: boolean;
  serial_port?: string | null;
}

/** True when any Meshtastic or MeshCore identity is on an active BLE connection. */
export function isMeshBleConnected(): boolean {
  const { identities } = useIdentityStore.getState();
  for (const identity of Object.values(identities)) {
    if (identity.protocol.type === 'reticulum') continue;
    const conn = getConnection(identity.id);
    if (conn?.connectionType !== 'ble') continue;
    if (conn.status === 'connecting' || conn.status === 'connected') return true;
  }
  return false;
}

export function hasEnabledReticulumBleInterface(
  interfaces: readonly ReticulumInterfaceBleRow[],
): boolean {
  return interfaces.some(
    (iface) =>
      iface.enabled &&
      (iface.type === 'ble_peer' ||
        (iface.type === 'rnode' &&
          typeof iface.serial_port === 'string' &&
          iface.serial_port.startsWith('ble://'))),
  );
}

export async function acquireReticulumBleAdapter(): Promise<boolean> {
  try {
    await window.electronAPI.bleAdapter.acquire('reticulum-sidecar');
    return true;
  } catch (err) {
    console.warn('[Reticulum] bleAdapter acquire failed:', err);
    return false;
  }
}

export async function releaseReticulumBleAdapter(): Promise<void> {
  try {
    await window.electronAPI.bleAdapter.release('reticulum-sidecar');
  } catch (err) {
    console.warn('[Reticulum] bleAdapter release failed:', err);
  }
}

export async function getBleAdapterOwner(): Promise<BleAdapterOwner | null> {
  try {
    const state = await window.electronAPI.bleAdapter.getState();
    return state.owner;
  } catch {
    // catch-no-log-ok getState failure treated as no lease holder
    return null;
  }
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
