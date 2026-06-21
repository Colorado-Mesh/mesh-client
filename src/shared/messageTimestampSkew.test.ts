import { describe, expect, it, vi } from 'vitest';

import {
  clampMeshcoreMessageTimestampForStorage,
  clampReadWatermarkMs,
  effectiveMessageTimestampMs,
  isUnreasonablyFutureMessageTimestampMs,
} from './messageTimestampSkew';

describe('messageTimestampSkew', () => {
  it('clamps unreasonably future message timestamps to now', () => {
    const nowMs = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    const future = nowMs + 8 * 365 * 24 * 3600 * 1000;
    expect(effectiveMessageTimestampMs(future, nowMs)).toBe(nowMs);
    expect(clampMeshcoreMessageTimestampForStorage(future, nowMs)).toBe(nowMs);
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
    expect(clampMeshcoreMessageTimestampForStorage(0, nowMs)).toBe(nowMs);
    expect(isUnreasonablyFutureMessageTimestampMs(0, nowMs)).toBe(false);
  });

  it('treats zero watermark as no last-read marker', () => {
    const nowMs = 1_700_000_000_000;
    expect(clampReadWatermarkMs(0, nowMs)).toBe(0);
  });
});
