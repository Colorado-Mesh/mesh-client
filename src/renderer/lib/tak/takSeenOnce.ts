/**
 * True the first time `key` is seen within `ttlMs`, and records it. `seen` keeps insertion
 * order, so its oldest entry comes first: expired entries go before the lookup, and the oldest
 * goes only to make room for a new key, never before a repeat is checked.
 */
export function isFirstSeen(
  seen: Map<string, number>,
  key: string,
  nowMs: number,
  ttlMs: number,
  max: number,
): boolean {
  for (const [k, at] of seen) {
    if (nowMs - at < ttlMs) break;
    seen.delete(k);
  }
  if (seen.has(key)) return false;
  while (seen.size >= max) {
    const oldest = seen.keys().next().value;
    if (oldest === undefined) break;
    seen.delete(oldest);
  }
  seen.set(key, nowMs);
  return true;
}
