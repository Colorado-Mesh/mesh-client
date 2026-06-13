// Time thresholds for node freshness
const STALE_MS = 2 * 3_600_000; // 2 hours
const OFFLINE_MS = 7 * 24 * 3_600_000; // 7 days

/** Max device clock lead we accept before treating timestamp as receive-time est. */
export const LAST_HEARD_MAX_FUTURE_SKEW_SEC = 300; // 5 min

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
 * Clamp a Unix-second last_heard that is unreasonably far in the future (device RTC skew).
 * Returns `nowSec` when the lead exceeds `maxFutureSkewSec`; otherwise returns floored seconds.
 */
export function clampLastHeardSec(
  lastHeardSec: number,
  nowSec = Math.floor(Date.now() / 1000),
  maxFutureSkewSec = LAST_HEARD_MAX_FUTURE_SKEW_SEC,
): number {
  if (!lastHeardSec || !Number.isFinite(lastHeardSec)) return 0;
  const floored = Math.floor(lastHeardSec);
  if (floored <= nowSec + maxFutureSkewSec) return floored;
  return nowSec;
}

/** Effective last-heard in ms for age calculations; never after `nowMs`. */
export function effectiveLastHeardMs(lastHeard: number, nowMs = Date.now()): number {
  const normalized = normalizeLastHeardMs(lastHeard);
  if (!normalized) return 0;
  return Math.min(normalized, nowMs);
}

/**
 * Effective chat message timestamp in ms; caps device RTC skew beyond `maxFutureSkewSec`.
 * Timestamps unreasonably far in the future clamp to `nowMs` (receive-time estimate).
 */
export function effectiveMessageTimestampMs(
  timestampMs: number,
  nowMs = Date.now(),
  maxFutureSkewSec = LAST_HEARD_MAX_FUTURE_SKEW_SEC,
): number {
  if (!timestampMs || !Number.isFinite(timestampMs)) return nowMs;
  const maxFuture = nowMs + maxFutureSkewSec * 1000;
  if (timestampMs > maxFuture) return nowMs;
  return timestampMs;
}

/** Cap a last-read watermark so device-ahead clocks cannot suppress future unread badges. */
export function clampReadWatermarkMs(
  watermarkMs: number,
  nowMs = Date.now(),
  maxFutureSkewSec = LAST_HEARD_MAX_FUTURE_SKEW_SEC,
): number {
  if (!watermarkMs || !Number.isFinite(watermarkMs)) return 0;
  if (watermarkMs < 0) return 0;
  const maxAllowed = nowMs + maxFutureSkewSec * 1000;
  return Math.min(watermarkMs, maxAllowed);
}

/**
 * Return the most-recent last_heard in Unix seconds. Takes the maximum of the device's
 * `lastAdvert` and any previous `last_heard` from live events (DMs, channel messages, paths)
 * so that live-event freshness is never overwritten by a stale advert value from the radio.
 */
export function mergeMeshcoreLastHeardFromAdvert(
  advertSec: number | null | undefined,
  previousLastHeard: number | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  const deviceRaw =
    typeof advertSec === 'number' && Number.isFinite(advertSec) && advertSec > 0
      ? Math.floor(advertSec)
      : 0;
  const device = deviceRaw > 0 ? clampLastHeardSec(deviceRaw, nowSec) : 0;
  const prev = clampLastHeardSec(lastHeardToUnixSeconds(previousLastHeard ?? 0), nowSec);
  return clampLastHeardSec(Math.max(device, prev), nowSec);
}

export function getNodeStatus(
  lastHeard: number,
  staleThresholdMs?: number,
  offlineThresholdMs?: number,
): NodeStatus {
  if (!lastHeard || !Number.isFinite(lastHeard)) return 'offline';
  const nowMs = Date.now();
  const effectiveMs = effectiveLastHeardMs(lastHeard, nowMs);
  if (!effectiveMs) return 'offline';
  const diff = nowMs - effectiveMs;
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
