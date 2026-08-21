/** Values at or above this threshold are treated as epoch milliseconds; below as Unix seconds. */
export const LAST_HEARD_MS_THRESHOLD = 1_000_000_000_000;

/** Max divisions when collapsing Date×1000 overshoot (~1e15 / ~1e18) down to unix seconds. */
const LAST_HEARD_NORMALIZE_MAX_DIVISIONS = 3;

/** Normalize epoch seconds or milliseconds (incl. double-converted ms) to Unix seconds. */
export function normalizeLastHeardToUnixSec(lastHeard: number): number {
  if (!lastHeard || !Number.isFinite(lastHeard)) return 0;
  let value = Math.floor(lastHeard);
  // Collapse double-converted ms (e.g. Date×1000 → ~1e15) down to unix seconds.
  for (let i = 0; i < LAST_HEARD_NORMALIZE_MAX_DIVISIONS && value >= LAST_HEARD_MS_THRESHOLD; i++) {
    value = Math.floor(value / 1000);
  }
  return value;
}

/**
 * SQL expression fragment for comparing mixed-unit legacy `last_heard` values as Unix seconds.
 * Mirrors {@link normalizeLastHeardToUnixSec} three-pass /1000: ~1e18 → /1e9, ~1e15 → /1e6, ~1e12 → /1e3.
 */
export const NODES_LAST_HEARD_SEC_SQL =
  'CASE WHEN last_heard >= 1000000000000000000 THEN CAST(last_heard / 1000000000 AS INTEGER) WHEN last_heard >= 1000000000000000 THEN CAST(last_heard / 1000000 AS INTEGER) WHEN last_heard >= 1000000000000 THEN CAST(last_heard / 1000 AS INTEGER) ELSE last_heard END';
