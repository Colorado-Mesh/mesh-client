/** Max device clock lead we accept before replacing chat timestamps with local receive time. */
export const MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC = 300; // 5 min

/** True when raw device timestamp is unreasonably far in the future (RTC skew / poison). */
export function isUnreasonablyFutureMessageTimestampMs(
  timestampMs: number,
  nowMs = Date.now(),
  maxFutureSkewSec = MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
): boolean {
  // Zero/negative = missing wire timestamp, not Unix epoch (1970-01-01).
  if (timestampMs <= 0 || !Number.isFinite(timestampMs)) return false;
  return timestampMs > nowMs + maxFutureSkewSec * 1000;
}

/**
 * Effective chat message timestamp in ms; caps device RTC skew beyond `maxFutureSkewSec`.
 * Missing or future-skewed timestamps are replaced with `nowMs` (local receive time).
 */
export function effectiveMessageTimestampMs(
  timestampMs: number,
  nowMs = Date.now(),
  maxFutureSkewSec = MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
): number {
  // Zero/negative = missing wire timestamp; use receive time instead of Unix epoch.
  if (timestampMs <= 0 || !Number.isFinite(timestampMs)) return nowMs;
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
  // Zero = no last-read watermark (never read), not Unix epoch.
  if (watermarkMs <= 0 || !Number.isFinite(watermarkMs)) return 0;
  const maxAllowed = nowMs + maxFutureSkewSec * 1000;
  return Math.min(watermarkMs, maxAllowed);
}
