/**
 * Link-timeout failure-bridge dest dedupe.
 *
 * The runtime must not permanently skip a destination after the first bridge apply —
 * a later Send to the same peer would stay stuck on Sending forever. Clear the dest
 * when a new outbound starts so a subsequent timeout can fail that attempt.
 */

export function normalizeLinkTimeoutDestHash(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

/** True when this dest was already failed by the bridge and should be skipped. */
export function shouldSkipLinkTimeoutDest(
  processed: ReadonlySet<string>,
  destinationHash: string,
): boolean {
  const norm = normalizeLinkTimeoutDestHash(destinationHash);
  if (norm.length !== 32) return true;
  return processed.has(norm);
}

/** Mark dest as processed; returns normalized hash or null if invalid. */
export function markLinkTimeoutDestProcessed(
  processed: Set<string>,
  destinationHash: string,
): string | null {
  const norm = normalizeLinkTimeoutDestHash(destinationHash);
  if (norm.length !== 32) return null;
  processed.add(norm);
  return norm;
}

/** Allow a later link-timeout bridge to fail new Sends to this dest. */
export function clearLinkTimeoutDestProcessed(
  processed: Set<string>,
  destinationHash: string,
): void {
  const norm = normalizeLinkTimeoutDestHash(destinationHash);
  if (!norm) return;
  processed.delete(norm);
}
