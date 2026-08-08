import { MS_PER_MINUTE } from '@/shared/timeConstants';

/**
 * How long a failed sync target stays omitted from the cascade. A dead node that still
 * announces the lowest hop count would otherwise be retried on every auto-sync tick,
 * burning minutes before the cascade can settle on the local inbox.
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
 * Drop targets that failed within the backoff window. When every discovered PN just failed,
 * the next cascade must skip them and fall through to configured remotes / local-prop instead
 * of retrying the same dead set for another full establish timeout each.
 */
export function omitRecentlyFailedPropagationTargets<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  nowMs = Date.now(),
): T[] {
  return items.filter((item) => !hasRecentReticulumPropagationSyncFailure(keyOf(item), nowMs));
}
