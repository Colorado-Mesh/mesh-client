import { isReticulumSidecarRateLimitError } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { MS_PER_SECOND } from '@/shared/timeConstants';

const DEFAULT_BACKOFF_MS = 5 * MS_PER_SECOND;
const MAX_BACKOFF_MS = 60 * MS_PER_SECOND;

let backoffUntilMs = 0;
let consecutiveHits = 0;

/** True while shared/dedicated proxy rate-limit backoff is active. */
export function isReticulumProxyRateLimitBackoffActive(now = Date.now()): boolean {
  return now < backoffUntilMs;
}

/** Remaining backoff ms (0 when clear). */
export function reticulumProxyRateLimitBackoffRemainingMs(now = Date.now()): number {
  return Math.max(0, backoffUntilMs - now);
}

/**
 * Record a rate-limit error and arm exponential backoff so callers do not tight-loop.
 * Returns the backoff duration applied (ms).
 */
export function noteReticulumProxyRateLimitHit(now = Date.now()): number {
  consecutiveHits = Math.min(consecutiveHits + 1, 6);
  const delay = Math.min(DEFAULT_BACKOFF_MS * 2 ** (consecutiveHits - 1), MAX_BACKOFF_MS);
  backoffUntilMs = Math.max(backoffUntilMs, now + delay);
  console.warn(
    `[reticulumProxyRateLimit] backoff ${delay}ms hits=${consecutiveHits} until=${new Date(backoffUntilMs).toISOString()}`,
  );
  return delay;
}

/** Clear backoff after a successful proxy call. */
export function clearReticulumProxyRateLimitBackoff(): void {
  consecutiveHits = 0;
  backoffUntilMs = 0;
}

/** If `err` is a rate-limit error, arm backoff and return true. */
export function noteReticulumProxyErrorIfRateLimited(err: unknown): boolean {
  if (!isReticulumSidecarRateLimitError(err)) return false;
  noteReticulumProxyRateLimitHit();
  return true;
}

/** Test-only reset. */
export function resetReticulumProxyRateLimitBackoffForTests(): void {
  consecutiveHits = 0;
  backoffUntilMs = 0;
}
