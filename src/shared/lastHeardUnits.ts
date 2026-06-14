/** Values at or above this threshold are treated as epoch milliseconds; below as Unix seconds. */
export const LAST_HEARD_MS_THRESHOLD = 1_000_000_000_000;

/** Normalize epoch seconds or milliseconds to Unix seconds for SQLite `nodes.last_heard`. */
export function normalizeLastHeardToUnixSec(lastHeard: number): number {
  if (!lastHeard || !Number.isFinite(lastHeard)) return 0;
  return lastHeard >= LAST_HEARD_MS_THRESHOLD
    ? Math.floor(lastHeard / 1000)
    : Math.floor(lastHeard);
}

/** SQL expression fragment for comparing mixed-unit legacy `last_heard` values as Unix seconds. */
export const NODES_LAST_HEARD_SEC_SQL =
  'CASE WHEN last_heard >= 1000000000000 THEN CAST(last_heard / 1000 AS INTEGER) ELSE last_heard END';
