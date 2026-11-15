/**
 * Visible-node budget for Graph / Topology after hop filters.
 * Decoupled from FORCE_REPULSION_FULL_PAIR_CAP (400): above that the force sim
 * already uses grid repulsion, so the draw budget can be higher.
 */
export const TOPOLOGY_GRAPH_DISTANT_NODE_CAP = 1000;

/** Post-hop-filter layout budget (prefer closer hops when truncating). */
export function topologyGraphVisibleNodeCap(): number {
  return TOPOLOGY_GRAPH_DISTANT_NODE_CAP;
}

/**
 * Hop-filter dropdown presets capped by the protocol wire max.
 * Meshtastic (≤7): 1, 2, 3, 5, 7. MeshCore/RNS (≥64): 1, 2, 3, 5, 8, 16, 32, 64.
 */
export function topologyHopFilterOptions(maxHopLimit: number): number[] {
  const presets = maxHopLimit <= 7 ? [1, 2, 3, 5, 7] : [1, 2, 3, 5, 8, 16, 32, 64];
  return presets.filter((hops) => hops <= maxHopLimit);
}

/**
 * Hop visibility for Graph / Topology.
 * Numeric Max hops hides peers above that count (and unknown hops).
 * Show all (`maxHops == null`) includes every peer, including unknown hops.
 */
export function topologyPeerPassesHopFilters(
  hops: number | null | undefined,
  maxHops: number | null,
): boolean {
  if (hops == null || !Number.isFinite(hops)) return maxHops == null;
  if (maxHops != null && hops > maxHops) return false;
  return true;
}
