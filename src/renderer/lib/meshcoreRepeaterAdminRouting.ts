import { resolveMeshcoreRoomLoginHopsAway } from './meshcoreUtils';
import type { MeshNode } from './types';

/** Use the current companion route for admin operations; displayed hops can be stale. */
export function resolveMeshcoreAdminHopsAway(
  node: Pick<MeshNode, 'hops_away'> | undefined,
  outPathBytes: Uint8Array | undefined,
): number {
  // An absent contact route is unknown, whereas a known empty route is direct.
  if (outPathBytes === undefined) {
    const hops = node?.hops_away;
    return typeof hops === 'number' && Number.isFinite(hops) ? Math.max(0, Math.trunc(hops)) : 0;
  }
  return resolveMeshcoreRoomLoginHopsAway(node, outPathBytes);
}
