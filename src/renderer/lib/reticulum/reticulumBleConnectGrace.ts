/**
 * Shared BLE connect grace clock for Reticulum Noble yield + local-interface health.
 * Owned here so watcher and interface snapshot cannot drift.
 */
import { RETICULUM_BLE_CONNECT_GRACE_MS } from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';

let graceExpiresAtMs = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getReticulumBleConnectGraceExpiresAt(): number {
  return graceExpiresAtMs;
}

/** Start (or renew) the OS passkey / BLE RNode connect grace window. */
export function beginReticulumBleConnectGrace(nowMs = Date.now()): number {
  graceExpiresAtMs = nowMs + RETICULUM_BLE_CONNECT_GRACE_MS;
  notify();
  return graceExpiresAtMs;
}

/** Clear grace (sidecar inactive / teardown). */
export function clearReticulumBleConnectGrace(): void {
  if (graceExpiresAtMs === 0) return;
  graceExpiresAtMs = 0;
  notify();
}

/** Subscribe to grace changes (React hooks sync local state). */
export function subscribeReticulumBleConnectGrace(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper. */
export function resetReticulumBleConnectGraceForTests(): void {
  graceExpiresAtMs = 0;
  listeners.clear();
}
