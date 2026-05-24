import { LAST_HEARD_MAX_FUTURE_SKEW_SEC } from '@/renderer/lib/nodeStatus';

/** Normalize Meshtastic packet rxTime (Date, Unix seconds, or ms) to epoch ms. */
export function meshtasticPacketRxTimeMs(rxTime: unknown): number {
  if (rxTime instanceof Date) {
    const ms = rxTime.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }
  if (typeof rxTime === 'number' && Number.isFinite(rxTime) && rxTime > 0) {
    return rxTime < 1_000_000_000_000 ? rxTime * 1000 : rxTime;
  }
  return 0;
}

/**
 * Merge last_heard from a live RF packet. Skips bumps during configure replay.
 * Falls back to Date.now() when rxTime is missing (position/traceroute replies).
 */
export function mergeMeshtasticLivePacketLastHeard(
  existingLastHeard: number,
  packetRxTimeMs: number,
  isConfiguring: boolean,
): number {
  if (isConfiguring) return existingLastHeard;
  const rx = packetRxTimeMs > 0 ? packetRxTimeMs : Date.now();
  return Math.max(existingLastHeard || 0, rx);
}

/**
 * Merge last_heard from onUserPacket using packet rxTime; skip bumps during configure replay.
 * No Date.now() fallback when rxTime is missing (NodeDB replay may lack rxTime).
 */
export function mergeMeshtasticUserPacketLastHeard(
  existingLastHeard: number,
  packetRxTimeMs: number,
  isConfiguring: boolean,
): number {
  if (isConfiguring || !Number.isFinite(packetRxTimeMs) || packetRxTimeMs <= 0) {
    return existingLastHeard;
  }
  return Math.max(existingLastHeard || 0, packetRxTimeMs);
}

/**
 * Merge NodeDB info.lastHeard with client-side last_heard (max wins).
 * Self node falls back to Date.now() when both inputs are 0 (#272).
 */
export function computeNodeInfoLastHeardMs(
  infoLastHeard: number | undefined,
  existingLastHeard: number,
  isSelf: boolean,
): number {
  let fromInfo = 0;
  if ((infoLastHeard ?? 0) > 0) {
    const ms = infoLastHeard! * 1000;
    const maxMs = Date.now() + LAST_HEARD_MAX_FUTURE_SKEW_SEC * 1000;
    fromInfo = ms > maxMs ? Date.now() : ms;
  }
  const selfFallback = isSelf && fromInfo === 0 && (existingLastHeard ?? 0) === 0 ? Date.now() : 0;
  return Math.max(fromInfo, existingLastHeard || 0, selfFallback);
}

/** Node IDs whose last_heard should bump on a traceroute reply. */
export function meshtasticTracerouteLastHeardNodeIds(
  meshFrom: number,
  correlatedDest: number | undefined,
): number[] {
  const ids = new Set<number>();
  if (meshFrom > 0) ids.add(meshFrom);
  if (correlatedDest !== undefined && correlatedDest > 0) ids.add(correlatedDest);
  return [...ids];
}
