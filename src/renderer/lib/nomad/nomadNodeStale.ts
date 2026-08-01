import { MS_PER_SECOND } from '@/shared/timeConstants';

/** Soft UX threshold: last heard older than this may be offline despite "online". */
export const NOMAD_STALE_LAST_SEEN_SECS = 2 * 60 * 60;

/** True when `last_seen` (unix seconds) is older than {@link NOMAD_STALE_LAST_SEEN_SECS}. */
export function isNomadLastSeenStale(
  lastSeenSec: number | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (lastSeenSec == null || !Number.isFinite(lastSeenSec) || lastSeenSec <= 0) {
    return false;
  }
  const ageSec = Math.floor(nowMs / MS_PER_SECOND) - Math.floor(lastSeenSec);
  return ageSec >= NOMAD_STALE_LAST_SEEN_SECS;
}
