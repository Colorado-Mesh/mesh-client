import { LAST_HEARD_MS_THRESHOLD, normalizeLastHeardToUnixSec } from '../../shared/lastHeardUnits';
import {
  clampMeshcoreLastAdvertSec,
  isPlausibleMeshcoreLastAdvertSec,
} from '../../shared/meshcoreLastAdvertPlausible';
import {
  clampReadWatermarkMs as sharedClampReadWatermarkMs,
  effectiveMessageTimestampMs as sharedEffectiveMessageTimestampMs,
  MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
} from '../../shared/messageTimestampSkew';

export {
  isUnreasonablyFutureMessageTimestampMs,
  MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
} from '../../shared/messageTimestampSkew';

// Time thresholds for node freshness
const STALE_MS = 2 * 3_600_000; // 2 hours
const OFFLINE_MS = 7 * 24 * 3_600_000; // 7 days

/** Max device clock lead we accept before treating timestamp as receive-time est. */
export const LAST_HEARD_MAX_FUTURE_SKEW_SEC = MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC;

export type NodeStatus = 'online' | 'stale' | 'offline';

export function normalizeLastHeardMs(lastHeard: number): number {
  if (!lastHeard || !Number.isFinite(lastHeard)) return 0;
  let value = lastHeard;
  // Collapse Date×1000 overshoot (~1e15) to epoch milliseconds.
  const overshootMs = LAST_HEARD_MS_THRESHOLD * 1000;
  for (let i = 0; i < 3 && value >= overshootMs; i++) {
    value = Math.floor(value / 1000);
  }
  // MeshCore uses epoch seconds; Meshtastic paths usually use epoch milliseconds.
  return value < LAST_HEARD_MS_THRESHOLD ? value * 1000 : value;
}

/** Normalize epoch seconds or milliseconds to Unix seconds (for MeshCore contact merge). */
export function lastHeardToUnixSeconds(lastHeard: number): number {
  return normalizeLastHeardToUnixSec(lastHeard);
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
  return clampMeshcoreLastAdvertSec(lastHeardSec, nowSec, maxFutureSkewSec);
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
  return sharedEffectiveMessageTimestampMs(timestampMs, nowMs, maxFutureSkewSec);
}

/** Cap a last-read watermark so device-ahead clocks cannot suppress future unread badges. */
export function clampReadWatermarkMs(
  watermarkMs: number,
  nowMs = Date.now(),
  maxFutureSkewSec = LAST_HEARD_MAX_FUTURE_SKEW_SEC,
): number {
  return sharedClampReadWatermarkMs(watermarkMs, nowMs, maxFutureSkewSec);
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
    typeof advertSec === 'number' &&
    Number.isFinite(advertSec) &&
    advertSec > 0 &&
    isPlausibleMeshcoreLastAdvertSec(advertSec)
      ? Math.floor(advertSec)
      : 0;
  const device = deviceRaw > 0 ? clampLastHeardSec(deviceRaw, nowSec) : 0;
  const prevSec = lastHeardToUnixSeconds(previousLastHeard ?? 0);
  const prevRaw = prevSec > 0 && isPlausibleMeshcoreLastAdvertSec(prevSec) ? prevSec : 0;
  const prev = clampLastHeardSec(prevRaw, nowSec);
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

/** Initial great-circle bearing from point 1 to point 2 in degrees [0, 360); NaN if invalid. */
export function bearingBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lon1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lon2)
  ) {
    return NaN;
  }
  const toRad = Math.PI / 180;
  const phi1 = lat1 * toRad;
  const phi2 = lat2 * toRad;
  const dLambda = (lon2 - lon1) * toRad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Three-digit degrees, e.g. `045°`; `—` when not finite. */
export function formatBearing(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const whole = Math.round(((deg % 360) + 360) % 360) % 360;
  return `${String(whole).padStart(3, '0')}°`;
}

/** Metres below 1 km, one decimal below 100 km, whole km beyond; `—` when invalid. */
export function formatRangeKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
