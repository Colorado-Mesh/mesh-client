import type { BleAdapterOwner } from '@/shared/electron-api.types';

export function isReticulumBleBusyErrorMessage(message: string): boolean {
  return /Bluetooth adapter is in use by Reticulum BLE/i.test(message);
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

export async function isNobleBleBlockedByReticulumLease(): Promise<boolean> {
  return (await getBleAdapterOwner()) === 'reticulum-sidecar';
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
