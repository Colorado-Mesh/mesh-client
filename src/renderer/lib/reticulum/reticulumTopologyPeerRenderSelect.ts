import type { ReticulumPeerWireRow } from '@/shared/reticulum-types';

import {
  filterReticulumTopologyRfOnly,
  type ReticulumTopologyRfInterface,
} from './reticulumTopologyRfFilter';

/** Cap path-table rows fed into the topology force graph (sidecar also caps at 2000). */
export const TOPOLOGY_PEER_RENDER_CAP = 800;

export interface SelectReticulumTopologyPeersForRenderOptions {
  rfOnly?: boolean;
  cap?: number;
}

/**
 * Apply RF-only (when requested) before the last-seen ingest slice so a TCP-heavy
 * path table cannot starve RF peers.
 */
export function selectReticulumTopologyPeersForRender(
  peers: readonly ReticulumPeerWireRow[],
  interfaces: readonly ReticulumTopologyRfInterface[],
  opts?: SelectReticulumTopologyPeersForRenderOptions,
): ReticulumPeerWireRow[] {
  const cap = opts?.cap ?? TOPOLOGY_PEER_RENDER_CAP;
  const rfOnly = opts?.rfOnly === true;
  const selected = rfOnly ? filterReticulumTopologyRfOnly(interfaces, peers).peers : [...peers];
  if (selected.length <= cap) return selected;
  return [...selected].sort((a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0)).slice(0, cap);
}
