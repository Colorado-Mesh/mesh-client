import { describe, expect, it, vi } from 'vitest';

import {
  clampReadWatermarkMs,
  effectiveMessageTimestampMs,
  isUnreasonablyFutureMessageTimestampMs,
  MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC,
} from './messageTimestampSkew';
import { MS_PER_YEAR } from './timeConstants';

/** Well beyond MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC — simulates poisoned RTC skew. */
const EIGHT_YEARS_MS = 8 * MS_PER_YEAR;

describe('messageTimestampSkew', () => {
  it('clamps unreasonably future message timestamps to now', () => {
    const nowMs = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const future = nowMs + EIGHT_YEARS_MS;
    expect(effectiveMessageTimestampMs(future, nowMs)).toBe(nowMs);
    expect(isUnreasonablyFutureMessageTimestampMs(future, nowMs)).toBe(true);
    vi.useRealTimers();
  });

  it('preserves timestamps within skew window', () => {
    const nowMs = 1_700_000_000_000;
    const within = nowMs + 60_000;
    expect(effectiveMessageTimestampMs(within, nowMs)).toBe(within);
    expect(isUnreasonablyFutureMessageTimestampMs(within, nowMs)).toBe(false);
  });

  it('treats zero message timestamp as missing (not Unix epoch)', () => {
    const nowMs = 1_700_000_000_000;
    expect(effectiveMessageTimestampMs(0, nowMs)).toBe(nowMs);
    expect(isUnreasonablyFutureMessageTimestampMs(0, nowMs)).toBe(false);
  });

  it('treats negative and non-finite message timestamps as missing', () => {
    const nowMs = 1_700_000_000_000;
    for (const bad of [-1, -1000, NaN, Infinity, -Infinity]) {
      expect(effectiveMessageTimestampMs(bad, nowMs)).toBe(nowMs);
      expect(isUnreasonablyFutureMessageTimestampMs(bad, nowMs)).toBe(false);
    }
  });

  it('treats zero watermark as no last-read marker', () => {
    const nowMs = 1_700_000_000_000;
    expect(clampReadWatermarkMs(0, nowMs)).toBe(0);
  });

  it('clamps watermark beyond max future skew to allowed maximum', () => {
    const nowMs = 1_700_000_000_000;
    const maxAllowed = nowMs + MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC * 1000;
    const farFuture = nowMs + EIGHT_YEARS_MS;
    expect(clampReadWatermarkMs(farFuture, nowMs)).toBe(maxAllowed);
  });

  it('preserves watermark within skew window', () => {
    const nowMs = 1_700_000_000_000;
    const within = nowMs + 60_000;
    expect(clampReadWatermarkMs(within, nowMs)).toBe(within);
  });

  it('treats negative and non-finite watermarks as no last-read marker', () => {
    const nowMs = 1_700_000_000_000;
    for (const bad of [-1, -1000, NaN, Infinity, -Infinity]) {
      expect(clampReadWatermarkMs(bad, nowMs)).toBe(0);
    }
  });
});
