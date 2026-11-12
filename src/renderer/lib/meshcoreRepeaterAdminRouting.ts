import { touch } from '@/shared/touch';

import {
  meshcoreTracePingRadioHasNoRoute,
  meshcoreTracePingRadioSaysDirect,
} from './meshcoreRepeaterTracePath';
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

/**
 * Hop count TRACE/Ping should plan from.
 * Radio-direct `outPathLen` forces zero hops. Radio `0xFF` (no route) keeps UI/advert hops so
 * direct-first + 1-hop synthesis can run. Otherwise use the same companion-route rules as
 * repeater/Room admin (known empty path → direct).
 */
export function resolveMeshcorePingHopsAway(opts: {
  node: Pick<MeshNode, 'hops_away'> | undefined;
  /** Known companion route bytes; empty array means "radio has this contact but no route". */
  routeBytes: Uint8Array | undefined;
  radioContactPathLen: number | null | undefined;
  radioPathLeftover: boolean | undefined;
}): number {
  touch(opts.radioPathLeftover);
  if (meshcoreTracePingRadioSaysDirect(opts.radioContactPathLen)) {
    return 0;
  }
  if (meshcoreTracePingRadioHasNoRoute(opts.radioContactPathLen)) {
    return resolveMeshcoreAdminHopsAway(opts.node, undefined);
  }
  return resolveMeshcoreAdminHopsAway(opts.node, opts.routeBytes);
}
