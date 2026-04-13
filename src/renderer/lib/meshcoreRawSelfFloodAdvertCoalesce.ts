import { MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS } from './timeConstants';

/** Minimal fields for coalescing MeshCore raw log rows (avoids importing `RxPacketEntry` cycles). */
export interface SelfFloodAdvertRxLike {
  ts: number;
  fromNodeId: number | null;
  routeTypeString: string | null;
  payloadTypeString: string | null;
}

/**
 * True when `next` should replace `last` in the raw packet log (same self node, FLOOD ADVERT,
 * within the coalesce window). Used when the radio/stack delivers two distinct frames shortly apart.
 */
export function shouldCoalesceSelfFloodAdvert(
  last: SelfFloodAdvertRxLike | undefined,
  next: SelfFloodAdvertRxLike,
  myNodeId: number,
  windowMs: number = MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS,
): boolean {
  if (myNodeId === 0) return false;
  if (!last) return false;
  if (last.fromNodeId !== myNodeId || next.fromNodeId !== myNodeId) return false;
  if (last.routeTypeString !== 'FLOOD' || next.routeTypeString !== 'FLOOD') return false;
  if (last.payloadTypeString !== 'ADVERT' || next.payloadTypeString !== 'ADVERT') return false;
  return Math.abs(next.ts - last.ts) <= windowMs;
}
