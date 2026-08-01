import { afterEach, describe, expect, it, vi } from 'vitest';

import { isNomadLastSeenStale, NOMAD_STALE_LAST_SEEN_SECS } from './nomadNodeStale';

describe('isNomadLastSeenStale', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is false for missing or invalid timestamps', () => {
    expect(isNomadLastSeenStale(null)).toBe(false);
    expect(isNomadLastSeenStale(undefined)).toBe(false);
    expect(isNomadLastSeenStale(0)).toBe(false);
    expect(isNomadLastSeenStale(Number.NaN)).toBe(false);
  });

  it('is false when last heard is recent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T20:00:00Z'));
    const nowSec = Math.floor(Date.now() / 1000);
    expect(isNomadLastSeenStale(nowSec - 60)).toBe(false);
    expect(isNomadLastSeenStale(nowSec - (NOMAD_STALE_LAST_SEEN_SECS - 1))).toBe(false);
  });

  it('is true when last heard exceeds the soft threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T20:00:00Z'));
    const nowSec = Math.floor(Date.now() / 1000);
    expect(isNomadLastSeenStale(nowSec - NOMAD_STALE_LAST_SEEN_SECS)).toBe(true);
    expect(isNomadLastSeenStale(nowSec - NOMAD_STALE_LAST_SEEN_SECS - 100)).toBe(true);
  });
});
