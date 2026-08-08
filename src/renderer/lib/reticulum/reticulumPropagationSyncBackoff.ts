import { MS_PER_MINUTE } from '@/shared/timeConstants';

/**
 * How long a failed sync target stays deprioritized. A dead node that still announces the
 * lowest hop count would otherwise be retried first on every auto-sync tick, burning the
 * whole establish window before the cascade can reach a node that works.
 */
export const RETICULUM_PROPAGATION_SYNC_FAILURE_BACKOFF_MS = 15 * MS_PER_MINUTE;

/** Sync target id (row id, `local-prop`, or destination hash) to last failure time. */
const failures = new Map<string, number>();

function backoffKey(id: string): string {
  return id.toLowerCase();
}

export function noteReticulumPropagationSyncFailure(id: string, atMs = Date.now()): void {
  if (id.length === 0) return;
  failures.set(backoffKey(id), atMs);
}

export function clearReticulumPropagationSyncFailure(id: string): void {
  failures.delete(backoffKey(id));
}

/** Test seam — session memory only, nothing is persisted. */
export function resetReticulumPropagationSyncFailures(): void {
  failures.clear();
}

export function hasRecentReticulumPropagationSyncFailure(id: string, nowMs = Date.now()): boolean {
  const at = failures.get(backoffKey(id));
  if (at == null) return false;
  if (nowMs - at >= RETICULUM_PROPAGATION_SYNC_FAILURE_BACKOFF_MS) {
    failures.delete(backoffKey(id));
    return false;
  }
  return true;
}

/**
 * Stable partition: targets that failed within the backoff window move to the back, keeping
 * their relative order. Nothing is dropped — a mesh where every node failed recently still
 * retries them all, just after any untried node.
 */
export function deprioritizeRecentlyFailedPropagationTargets<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  nowMs = Date.now(),
): T[] {
  const fresh: T[] = [];
  const recentlyFailed: T[] = [];
  for (const item of items) {
    if (hasRecentReticulumPropagationSyncFailure(keyOf(item), nowMs)) {
      recentlyFailed.push(item);
    } else {
      fresh.push(item);
    }
  }
  return [...fresh, ...recentlyFailed];
}
