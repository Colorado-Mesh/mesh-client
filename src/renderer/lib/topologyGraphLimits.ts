import { FORCE_REPULSION_FULL_PAIR_CAP } from './forceDirectedGraphLayout';

/** Visible-node budget when distant peers are hidden (nearby / 0–1 hop maps). */
export const TOPOLOGY_GRAPH_NEARBY_NODE_CAP = 48;

/**
 * Visible-node budget when distant peers are shown. Matches the force-layout
 * all-pairs repulsion cutoff so large MQTT / RNS maps stay interactive.
 */
export const TOPOLOGY_GRAPH_DISTANT_NODE_CAP = FORCE_REPULSION_FULL_PAIR_CAP;

/** Mesh Graph nearby ceiling when distant peers are off and Max hops is All. */
export const MESH_TOPOLOGY_NEARBY_MAX_HOPS = 1;
/**
 * Reticulum Topology nearby ceiling when distant peers are off and Max hops is All.
 * RNS hop counts are 1-based for a direct path.
 */
export const RETICULUM_TOPOLOGY_NEARBY_MAX_HOPS = 2;

/** Layout budget after hop filters. Not gated by Show distant (48 hid 1-hop neighbors). */
export function topologyGraphVisibleNodeCap(): number {
  return TOPOLOGY_GRAPH_DISTANT_NODE_CAP;
}

export interface TopologyHopFilterState {
  includeDistantPeers: boolean;
  maxHops: number | null;
  nearbyMaxHops: number;
}

/**
 * Hop visibility for Graph / Topology.
 * Numeric Max hops always applies. Unknown hops are included only when Max hops
 * is All and Show distant is on — they are not 1-hop neighbors.
 * Distant-off nearby ceiling applies only when Max hops is All.
 */
export function topologyPeerPassesHopFilters(
  hops: number | null | undefined,
  opts: TopologyHopFilterState,
): boolean {
  if (hops == null || !Number.isFinite(hops)) {
    return opts.includeDistantPeers && opts.maxHops == null;
  }
  if (opts.maxHops != null && hops > opts.maxHops) return false;
  if (!opts.includeDistantPeers && opts.maxHops == null && hops > opts.nearbyMaxHops) {
    return false;
  }
  return true;
}
