import {
  isReticulumBleRnodeInterfaceRow,
  isReticulumBleRnodeOnline,
  prepareReticulumBleRnodeConnect,
  releaseReticulumBleRnodeConnect,
} from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

export interface ReticulumNobleBleYieldMutableState {
  yieldActive: boolean;
}

export interface SyncReticulumNobleBleYieldInput {
  sidecarActive: boolean;
  interfaces: readonly ReticulumInterfaceRow[];
  nowMs: number;
  bleConnectGraceExpiresAt: number;
}

/**
 * Pair Noble BLE suspend (sidecar start or offline BLE RNode) with release once the RNode
 * is online, grace expires, or the sidecar stops. Tracks main-process yield when
 * scanOwner is already reticulum (fast-connect / already-online paths).
 */
export async function syncReticulumNobleBleYield(
  input: SyncReticulumNobleBleYieldInput,
  state: ReticulumNobleBleYieldMutableState,
): Promise<void> {
  const { sidecarActive, interfaces, nowMs, bleConnectGraceExpiresAt } = input;

  if (!sidecarActive) {
    if (state.yieldActive) {
      state.yieldActive = false;
      await releaseReticulumBleRnodeConnect();
      return;
    }
    const coexist = await window.electronAPI.bleCoexistence.getState();
    if (coexist.scanOwner === 'reticulum') {
      await releaseReticulumBleRnodeConnect();
    }
    return;
  }

  if (bleConnectGraceExpiresAt <= 0 || nowMs <= 0) {
    return;
  }

  const hasEnabledBleRnode = interfaces.some(
    (row) => row.enabled && isReticulumBleRnodeInterfaceRow(row),
  );
  const hasOfflineBleRnode = interfaces.some(
    (row) => row.enabled && isReticulumBleRnodeInterfaceRow(row) && !isReticulumBleRnodeOnline(row),
  );
  const bleRnodeOnline = interfaces.some((row) => isReticulumBleRnodeOnline(row));
  const graceExpired = nowMs >= bleConnectGraceExpiresAt;

  const coexist = await window.electronAPI.bleCoexistence.getState();
  const scanHeldByReticulum = coexist.scanOwner === 'reticulum';

  if ((scanHeldByReticulum || hasOfflineBleRnode) && !state.yieldActive) {
    state.yieldActive = true;
    if (!scanHeldByReticulum && hasOfflineBleRnode) {
      await prepareReticulumBleRnodeConnect();
    }
  }

  if (state.yieldActive && (!hasEnabledBleRnode || bleRnodeOnline || graceExpired)) {
    state.yieldActive = false;
    await releaseReticulumBleRnodeConnect();
  }
}
