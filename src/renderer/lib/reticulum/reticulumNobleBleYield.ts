import {
  isReticulumBleRnodeInterfaceRow,
  isReticulumBleRnodeOnline,
  prepareReticulumBleRnodeConnect,
  releaseReticulumBleRnodeConnect,
} from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import type { ReticulumInterfaceRow } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';

export interface ReticulumNobleBleYieldMutableState {
  yieldActive: boolean;
  /** Last failed prepare attempt (ms); used to back off while Noble holds the scan mutex. */
  lastPrepareFailedAtMs?: number;
}

export interface SyncReticulumNobleBleYieldInput {
  sidecarActive: boolean;
  interfaces: readonly ReticulumInterfaceRow[];
  nowMs: number;
  bleConnectGraceExpiresAt: number;
}

/** Avoid hammering suspendNoble while Meshtastic/MeshCore own the scan mutex. */
export const RETICULUM_NOBLE_YIELD_PREPARE_BACKOFF_MS = 15_000;

/**
 * Pair Noble BLE suspend (sidecar start or offline BLE RNode) with release once the RNode
 * is online, grace expires, or the sidecar stops. Tracks main-process yield when
 * scanOwner is already reticulum (fast-connect / already-online paths).
 *
 * Failure points:
 * - Meshtastic/MeshCore holds scanOwner=noble → prepare fails with BleScanBusyError.
 *   Fallback: leave yield inactive, back off; do not dispatch "yield released".
 * - Offline BLE RNode after grace → stop re-yielding so GATT reconnects can finish.
 */
export async function syncReticulumNobleBleYield(
  input: SyncReticulumNobleBleYieldInput,
  state: ReticulumNobleBleYieldMutableState,
): Promise<void> {
  const { sidecarActive, interfaces, nowMs, bleConnectGraceExpiresAt } = input;

  if (!sidecarActive) {
    if (state.yieldActive) {
      state.yieldActive = false;
      state.lastPrepareFailedAtMs = undefined;
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

  // After connect grace, never re-contend for the adapter: an offline BLE RNode would
  // otherwise loop suspendNoble ↔ yield-released forever and starve Meshtastic/MeshCore.
  if (graceExpired && !scanHeldByReticulum) {
    if (state.yieldActive) {
      state.yieldActive = false;
      state.lastPrepareFailedAtMs = undefined;
      await releaseReticulumBleRnodeConnect();
    }
    return;
  }

  if ((scanHeldByReticulum || hasOfflineBleRnode) && !state.yieldActive) {
    if (!scanHeldByReticulum && hasOfflineBleRnode) {
      const lastFail = state.lastPrepareFailedAtMs ?? 0;
      if (nowMs - lastFail < RETICULUM_NOBLE_YIELD_PREPARE_BACKOFF_MS) {
        return;
      }
      const acquired = await prepareReticulumBleRnodeConnect();
      if (!acquired) {
        state.lastPrepareFailedAtMs = nowMs;
        return;
      }
      state.lastPrepareFailedAtMs = undefined;
    }
    state.yieldActive = true;
  }

  if (state.yieldActive && (!hasEnabledBleRnode || bleRnodeOnline || graceExpired)) {
    state.yieldActive = false;
    state.lastPrepareFailedAtMs = undefined;
    await releaseReticulumBleRnodeConnect();
  }
}
