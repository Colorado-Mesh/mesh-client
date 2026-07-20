import type { MeshCoreNeighborEntry, MeshCoreNeighborResult } from './meshcore/meshcoreHookTypes';

export type MeshcoreNeighborPageMergeOutcome =
  | { action: 'replace' | 'append'; result: MeshCoreNeighborResult }
  | { action: 'keep'; result: MeshCoreNeighborResult }
  | { action: 'skip' };

function dedupeAppendByPrefixHex(
  existing: MeshCoreNeighborEntry[],
  page: MeshCoreNeighborEntry[],
): MeshCoreNeighborEntry[] {
  const seen = new Set(existing.map((n) => n.prefixHex));
  const out = existing.slice();
  for (const entry of page) {
    if (seen.has(entry.prefixHex)) continue;
    seen.add(entry.prefixHex);
    out.push(entry);
  }
  return out;
}

/**
 * Merge a GetNeighbours page into the cached result for a node.
 * - offset 0 → replace
 * - offset > 0 and cache length matches offset → append (dedupe by prefixHex)
 * - offset > 0 with missing/mismatched cache → keep existing or skip (do not install a mid-list page alone)
 */
export function mergeMeshcoreNeighborPage(
  existing: MeshCoreNeighborResult | undefined,
  page: MeshCoreNeighborResult,
  offset: number,
): MeshcoreNeighborPageMergeOutcome {
  const safeOffset = Math.max(0, Math.floor(offset));
  if (safeOffset === 0) {
    return { action: 'replace', result: page };
  }
  if (!existing) {
    console.warn(
      '[meshcoreNeighborPageMerge] skipping mid-list neighbors page with empty cache offset=' +
        String(safeOffset),
    );
    return { action: 'skip' };
  }
  if (existing.neighbours.length !== safeOffset) {
    console.warn(
      '[meshcoreNeighborPageMerge] neighbors append offset mismatch expected=' +
        String(existing.neighbours.length) +
        ' got=' +
        String(safeOffset),
    );
    return { action: 'keep', result: existing };
  }
  return {
    action: 'append',
    result: {
      totalNeighboursCount: page.totalNeighboursCount,
      neighbours: dedupeAppendByPrefixHex(existing.neighbours, page.neighbours),
      fetchedAt: page.fetchedAt,
    },
  };
}
