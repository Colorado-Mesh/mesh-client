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

export function topologyGraphVisibleNodeCap(includeDistantPeers: boolean): number {
  return includeDistantPeers ? TOPOLOGY_GRAPH_DISTANT_NODE_CAP : TOPOLOGY_GRAPH_NEARBY_NODE_CAP;
}

export interface TopologyHopFilterState {
  includeDistantPeers: boolean;
  maxHops: number | null;
  nearbyMaxHops: number;
}

/**
 * Hop visibility for Graph / Topology.
 * Numeric Max hops always applies (unknown hops pass). The distant-off nearby
 * ceiling applies only when Max hops is All — otherwise hop 2/8 is a no-op.
 */
export function topologyPeerPassesHopFilters(
  hops: number | null | undefined,
  opts: TopologyHopFilterState,
): boolean {
  if (hops == null || !Number.isFinite(hops)) return true;
  if (opts.maxHops != null && hops > opts.maxHops) return false;
  if (!opts.includeDistantPeers && opts.maxHops == null && hops > opts.nearbyMaxHops) {
    return false;
  }
  return true;
}
