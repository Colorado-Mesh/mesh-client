import { FORCE_REPULSION_FULL_PAIR_CAP } from './forceDirectedGraphLayout';

/** Visible-node budget when distant peers are hidden (nearby / 0–1 hop maps). */
export const TOPOLOGY_GRAPH_NEARBY_NODE_CAP = 48;

/**
 * Visible-node budget when distant peers are shown. Matches the force-layout
 * all-pairs repulsion cutoff so large MQTT / RNS maps stay interactive.
 */
export const TOPOLOGY_GRAPH_DISTANT_NODE_CAP = FORCE_REPULSION_FULL_PAIR_CAP;

export function topologyGraphVisibleNodeCap(includeDistantPeers: boolean): number {
  return includeDistantPeers ? TOPOLOGY_GRAPH_DISTANT_NODE_CAP : TOPOLOGY_GRAPH_NEARBY_NODE_CAP;
}
