// Time thresholds for node freshness
const STALE_MS = 2 * 3_600_000; // 2 hours
const OFFLINE_MS = 7 * 24 * 3_600_000; // 7 days

export type NodeStatus = 'online' | 'stale' | 'offline';

export function normalizeLastHeardMs(lastHeard: number): number {
  if (!lastHeard || !Number.isFinite(lastHeard)) return 0;
  // MeshCore uses epoch seconds; Meshtastic paths usually use epoch milliseconds.
  return lastHeard < 1_000_000_000_000 ? lastHeard * 1000 : lastHeard;
}

/** Normalize epoch seconds or milliseconds to Unix seconds (for MeshCore contact merge). */
export function lastHeardToUnixSeconds(lastHeard: number): number {
  if (!lastHeard || !Number.isFinite(lastHeard)) return 0;
  return lastHeard < 1_000_000_000_000 ? Math.floor(lastHeard) : Math.floor(lastHeard / 1000);
}

/**
 * Return the most-recent last_heard in Unix seconds. Takes the maximum of the device's
 * `lastAdvert` and any previous `last_heard` from live events (DMs, channel messages, paths)
 * so that live-event freshness is never overwritten by a stale advert value from the radio.
 */
export function mergeMeshcoreLastHeardFromAdvert(
  advertSec: number | null | undefined,
  previousLastHeard: number | null | undefined,
): number {
  const device =
    typeof advertSec === 'number' && Number.isFinite(advertSec) && advertSec > 0
      ? Math.floor(advertSec)
      : 0;
  const prev = Math.max(lastHeardToUnixSeconds(previousLastHeard ?? 0), 0);
  return Math.max(device, prev);
}

export function getNodeStatus(
  lastHeard: number,
  staleThresholdMs?: number,
  offlineThresholdMs?: number,
): NodeStatus {
  if (!lastHeard || !Number.isFinite(lastHeard)) return 'offline';
  const normalizedLastHeard = normalizeLastHeardMs(lastHeard);
  const diff = Date.now() - normalizedLastHeard;
  const stale = staleThresholdMs ?? STALE_MS;
  const offline = offlineThresholdMs ?? OFFLINE_MS;
  if (diff <= stale) return 'online';
  if (diff <= offline) return 'stale';
  return 'offline';
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return NaN;
  }
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
