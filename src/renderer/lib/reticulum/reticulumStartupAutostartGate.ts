/**
 * Cold-start gate: Meshtastic/MeshCore Noble BLE must not race Reticulum stack start + BLE RNode.
 * Sidecar start suspends Noble; parallel RF connect kills CoreBluetooth ("Event receiver died").
 */

import { RETICULUM_BLE_CONNECT_GRACE_MS } from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import { MS_PER_SECOND } from '@/shared/timeConstants';

let settled = false;
let settlePromise: Promise<void> | null = null;
let resolveSettle: (() => void) | null = null;

function ensureSettlePromise(): Promise<void> {
  if (settled) return Promise.resolve();
  settlePromise ??= new Promise<void>((resolve) => {
    resolveSettle = resolve;
  });
  return settlePromise;
}

/** Call when Reticulum capability/autostart is absent so RF is not blocked forever. */
export function skipReticulumStartupAutostartGate(): void {
  notifyReticulumStartupAutostartSettled();
}

/** Call after Reticulum stack autostart succeeds, fails, or is skipped. */
export function notifyReticulumStartupAutostartSettled(): void {
  if (settled) return;
  settled = true;
  resolveSettle?.();
  resolveSettle = null;
  settlePromise = Promise.resolve();
}

/** Test helper — reset module latch between cases. */
export function resetReticulumStartupAutostartGateForTests(): void {
  settled = false;
  settlePromise = null;
  resolveSettle = null;
}

export async function awaitReticulumStartupAutostartSettled(maxWaitMs = 45_000): Promise<void> {
  if (settled) return;
  await Promise.race([
    ensureSettlePromise(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, maxWaitMs);
    }),
  ]);
  notifyReticulumStartupAutostartSettled();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Must cover {@link RETICULUM_BLE_CONNECT_GRACE_MS} plus a small settle buffer.
 * A shorter default (35s) let Meshtastic/MeshCore busy-retry while scanOwner was
 * still reticulum and starve CoreBluetooth during the OS passkey window.
 */
export const RETICULUM_BLE_COEXISTENCE_CLEAR_MAX_MS =
  RETICULUM_BLE_CONNECT_GRACE_MS + 5 * MS_PER_SECOND;

/**
 * After stack autostart, wait until Reticulum's Noble yield decision has settled and the scan
 * yield is not held (RNode online or grace expired) so RF GATT connect does not fight CoreBluetooth.
 */
export async function awaitReticulumBleCoexistenceClear(
  maxWaitMs = RETICULUM_BLE_COEXISTENCE_CLEAR_MAX_MS,
): Promise<void> {
  await awaitReticulumStartupAutostartSettled(maxWaitMs);
  if (typeof window === 'undefined') {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (!window.electronAPI.bleCoexistence.getState) {
    return;
  }
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const state = await window.electronAPI.bleCoexistence.getState();
      const yieldPending = state.nobleYieldDecisionPending === true;
      if (!yieldPending && state.scanOwner !== 'reticulum') {
        return;
      }
    } catch {
      // catch-no-log-ok: bleCoexistence IPC can fail during teardown; do not block RF forever
      return;
    }
    await sleep(250);
  }
}
