/**
 * Destination hashes out of an `announce.received` payload.
 *
 * The sidecar batches announces into `payload.announces`; a bare object is a single
 * announce. Mirrors the container handling in `applyReticulumAnnounceReceivedOptimistic`.
 */
export function announceDestinationHashes(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const p = payload as Record<string, unknown>;
  const rows: unknown[] = Array.isArray(p.announces) ? p.announces : [p];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const raw = (row as { destination_hash?: unknown }).destination_hash;
    if (typeof raw !== 'string') continue;
    const normalized = raw.replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (normalized.length !== 32) continue;
    seen.add(normalized);
  }
  return [...seen];
}
