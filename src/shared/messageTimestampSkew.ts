/** Max device clock lead we accept before treating chat timestamps as receive-time estimate. */
export const MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC = 300; // 5 min

/** True when raw device timestamp is unreasonably far in the future (RTC skew / poison). */
export function isUnreasonablyFutureMessageTimestampMs(
  timestampMs: number,
  nowMs = Date.now(),
  maxFutureSkewSec = MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
): boolean {
  if (!timestampMs || !Number.isFinite(timestampMs)) return false;
  return timestampMs > nowMs + maxFutureSkewSec * 1000;
}

/**
 * Effective chat message timestamp in ms; caps device RTC skew beyond `maxFutureSkewSec`.
 * Timestamps unreasonably far in the future clamp to `nowMs` (receive-time estimate).
 */
export function effectiveMessageTimestampMs(
  timestampMs: number,
  nowMs = Date.now(),
  maxFutureSkewSec = MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
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
  maxFutureSkewSec = MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
): number {
  if (!watermarkMs || !Number.isFinite(watermarkMs)) return 0;
  if (watermarkMs < 0) return 0;
  const maxAllowed = nowMs + maxFutureSkewSec * 1000;
  return Math.min(watermarkMs, maxAllowed);
}

/** Clamp a MeshCore message timestamp before SQLite persist or IPC return. */
export function clampMeshcoreMessageTimestampForStorage(
  timestampMs: number,
  nowMs = Date.now(),
): number {
  return effectiveMessageTimestampMs(timestampMs, nowMs);
}
