import type { ReticulumPeerWireRow } from '@/shared/reticulum-types';

import { normalizeLastHeardMs } from '../nodeStatus';
import {
  RETICULUM_TOPOLOGY_NEARBY_MAX_HOPS,
  topologyPeerPassesHopFilters,
} from '../topologyGraphLimits';
import {
  filterReticulumTopologyRfOnly,
  type ReticulumTopologyRfInterface,
} from './reticulumTopologyRfFilter';

/** Cap path-table rows fed into the topology force graph (sidecar also caps at 2000). */
export const TOPOLOGY_PEER_RENDER_CAP = 800;

export interface SelectReticulumTopologyPeersForRenderOptions {
  rfOnly?: boolean;
  cap?: number;
  includeDistantPeers?: boolean;
  maxHops?: number | null;
}

/**
 * Apply RF-only (when requested) and hop filters before the last-seen ingest slice
 * so a TCP-heavy or distant path table cannot starve eligible peers.
 */
export function selectReticulumTopologyPeersForRender(
  peers: readonly ReticulumPeerWireRow[],
  interfaces: readonly ReticulumTopologyRfInterface[],
  opts?: SelectReticulumTopologyPeersForRenderOptions,
): ReticulumPeerWireRow[] {
  const cap = opts?.cap ?? TOPOLOGY_PEER_RENDER_CAP;
  const rfOnly = opts?.rfOnly === true;
  const selected = (
    rfOnly ? filterReticulumTopologyRfOnly(interfaces, peers).peers : [...peers]
  ).filter((peer) =>
    topologyPeerPassesHopFilters(peer.hops, {
      includeDistantPeers: opts?.includeDistantPeers !== false,
      maxHops: opts?.maxHops ?? null,
      nearbyMaxHops: RETICULUM_TOPOLOGY_NEARBY_MAX_HOPS,
    }),
  );
  if (selected.length <= cap) return selected;
  return [...selected]
    .sort((a, b) => lastSeenRank(b.last_seen) - lastSeenRank(a.last_seen))
    .slice(0, cap);
}

/** Newest-first ingest rank. Missing / NaN / non-positive last_seen sort as oldest. */
export function lastSeenRank(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return normalizeLastHeardMs(value);
}
