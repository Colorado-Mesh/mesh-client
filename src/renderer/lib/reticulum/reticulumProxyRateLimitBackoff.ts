import { isReticulumSidecarRateLimitError } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { MS_PER_SECOND } from '@/shared/timeConstants';

const DEFAULT_BACKOFF_MS = 5 * MS_PER_SECOND;
const MAX_BACKOFF_MS = 60 * MS_PER_SECOND;

/** Independent proxy IPC rate-limit backoff buckets. */
export type ReticulumProxyRateLimitBucket = 'shared' | 'lxmfRecent';

interface BucketState {
  backoffUntilMs: number;
  consecutiveHits: number;
}

const buckets: Record<ReticulumProxyRateLimitBucket, BucketState> = {
  shared: { backoffUntilMs: 0, consecutiveHits: 0 },
  lxmfRecent: { backoffUntilMs: 0, consecutiveHits: 0 },
};

function isBucketActive(bucket: ReticulumProxyRateLimitBucket, now: number): boolean {
  return now < buckets[bucket].backoffUntilMs;
}

function remainingForBucket(bucket: ReticulumProxyRateLimitBucket, now: number): number {
  return Math.max(0, buckets[bucket].backoffUntilMs - now);
}

/**
 * True while proxy rate-limit backoff is active.
 * When `bucket` is omitted, true if either bucket is active (peer-store / legacy callers).
 */
export function isReticulumProxyRateLimitBackoffActive(
  bucket?: ReticulumProxyRateLimitBucket,
  now = Date.now(),
): boolean {
  if (bucket == null) {
    return isBucketActive('shared', now) || isBucketActive('lxmfRecent', now);
  }
  return isBucketActive(bucket, now);
}

/**
 * Remaining backoff ms (0 when clear).
 * When `bucket` is omitted, returns the max remaining across both buckets.
 */
export function reticulumProxyRateLimitBackoffRemainingMs(
  bucket?: ReticulumProxyRateLimitBucket,
  now = Date.now(),
): number {
  if (bucket == null) {
    return Math.max(remainingForBucket('shared', now), remainingForBucket('lxmfRecent', now));
  }
  return remainingForBucket(bucket, now);
}

/** Optional ±10% jitter so concurrent clients do not retry in lockstep. */
function applyJitter(delayMs: number): number {
  const factor = 0.9 + Math.random() * 0.2;
  return Math.max(1, Math.round(delayMs * factor));
}

/**
 * Record a rate-limit error and arm exponential backoff so callers do not tight-loop.
 * Returns the backoff duration applied (ms, after jitter).
 */
export function noteReticulumProxyRateLimitHit(
  bucket: ReticulumProxyRateLimitBucket,
  now = Date.now(),
): number {
  const state = buckets[bucket];
  state.consecutiveHits = Math.min(state.consecutiveHits + 1, 6);
  const base = Math.min(DEFAULT_BACKOFF_MS * 2 ** (state.consecutiveHits - 1), MAX_BACKOFF_MS);
  const delay = applyJitter(base);
  state.backoffUntilMs = Math.max(state.backoffUntilMs, now + delay);
  console.warn(
    `[reticulumProxyRateLimit] bucket=${bucket} backoff ${delay}ms hits=${state.consecutiveHits} until=${new Date(state.backoffUntilMs).toISOString()}`,
  );
  return delay;
}

/** Clear backoff after a successful proxy call (one bucket, or both when omitted). */
export function clearReticulumProxyRateLimitBackoff(bucket?: ReticulumProxyRateLimitBucket): void {
  const clearOne = (b: ReticulumProxyRateLimitBucket): void => {
    buckets[b].consecutiveHits = 0;
    buckets[b].backoffUntilMs = 0;
  };
  if (bucket == null) {
    clearOne('shared');
    clearOne('lxmfRecent');
    return;
  }
  clearOne(bucket);
}

/** If `err` is a rate-limit error, arm backoff for `bucket` (default shared) and return true. */
export function noteReticulumProxyErrorIfRateLimited(
  err: unknown,
  bucket: ReticulumProxyRateLimitBucket = 'shared',
): boolean {
  if (!isReticulumSidecarRateLimitError(err)) return false;
  noteReticulumProxyRateLimitHit(bucket);
  return true;
}

/** Test-only reset. */
export function resetReticulumProxyRateLimitBackoffForTests(): void {
  clearReticulumProxyRateLimitBackoff();
}
