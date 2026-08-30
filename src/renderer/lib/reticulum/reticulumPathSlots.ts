/**
 * Pure path-slot types/helpers (no store / HTTP).
 *
 * Kept separate from `reticulumPathMedium` so `reticulumPeerStore` can depend on
 * slot helpers without a cycle when pathMedium applies routes onto the store.
 */

export type PathMedium = 'rf' | 'network';

export interface ReticulumPathSlot {
  active: boolean;
  hops: number | null;
  via_hash: string | null;
  interface: string | null;
  interface_id: number | null;
  medium: PathMedium | null;
  timestamp: number | null;
  expires: number | null;
  expired: boolean;
}

/** Active path: marked active + live, else first live slot, else first slot. */
export function activeReticulumPathSlot(
  paths: readonly ReticulumPathSlot[],
): ReticulumPathSlot | null {
  if (paths.length === 0) return null;
  return paths.find((s) => s.active && !s.expired) ?? paths.find((s) => !s.expired) ?? paths[0];
}

/** Non-expired slots excluding the chosen active slot (transport caps at 3 total). */
export function backupReticulumPathSlots(paths: readonly ReticulumPathSlot[]): ReticulumPathSlot[] {
  const active = activeReticulumPathSlot(paths);
  return paths.filter((s) => !s.expired && s !== active);
}

/** RRC link establishment uses path-scaled hops; reject stale multi-hop TCP routes. */
export const RRC_MAX_CONNECT_HOPS = 8;

/** Lowest-hop live network slot suitable for RRC auto-connect. */
export function bestReticulumRrcNetworkPathSlot(
  paths: readonly ReticulumPathSlot[],
): ReticulumPathSlot | null {
  let best: ReticulumPathSlot | null = null;
  for (const slot of paths) {
    if (slot.expired || slot.medium !== 'network') continue;
    if (slot.hops == null || slot.hops < 0 || slot.hops > RRC_MAX_CONNECT_HOPS) continue;
    if (!best || (best.hops ?? Number.POSITIVE_INFINITY) > slot.hops) {
      best = slot;
    }
  }
  return best;
}

/** Lowest-hop live slot (any medium) within the RRC hop cap. */
export function bestReticulumRrcPathSlot(
  paths: readonly ReticulumPathSlot[],
): ReticulumPathSlot | null {
  let best: ReticulumPathSlot | null = null;
  for (const slot of paths) {
    if (slot.expired) continue;
    if (slot.hops == null || slot.hops < 0 || slot.hops > RRC_MAX_CONNECT_HOPS) continue;
    if (!best || (best.hops ?? Number.POSITIVE_INFINITY) > slot.hops) {
      best = slot;
    }
  }
  return best;
}
