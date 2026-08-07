import { raceWithDeadline } from '@/renderer/lib/bleReconnectHelper';
import { RETICULUM_IPC_SEND_TIMEOUT_MS } from '@/renderer/lib/timeConstants';

/** Stable tag for timeout errors — UI maps via i18n (RRC / Chat). */
export const RETICULUM_IPC_SEND_TIMEOUT_TAG = 'RETICULUM_IPC_SEND_TIMEOUT';

/**
 * Bound a Reticulum IPC send (LXMF / RRC) so a stuck proxy cannot hang the UI forever.
 * Does not cancel the underlying request; callers treat timeout as failure.
 */
export function withReticulumIpcSendDeadline<T>(work: Promise<T>): Promise<T> {
  return raceWithDeadline(work, RETICULUM_IPC_SEND_TIMEOUT_MS, RETICULUM_IPC_SEND_TIMEOUT_TAG);
}

export function isReticulumIpcSendTimeout(err: unknown): boolean {
  return String(err instanceof Error ? err.message : err).includes(RETICULUM_IPC_SEND_TIMEOUT_TAG);
}
