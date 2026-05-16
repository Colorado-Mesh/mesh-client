import { describe, expect, it } from 'vitest';

import { formatShortRelativeAgo } from './formatShortRelativeAgo';

describe('formatShortRelativeAgo', () => {
  const nowMs = 1_700_000_000_000;

  it('returns null when nowMs is unset', () => {
    expect(formatShortRelativeAgo(0, nowMs / 1000)).toBeNull();
  });

  it('formats meshcore last_heard in seconds', () => {
    const twoMinutesAgoSec = Math.floor((nowMs - 120_000) / 1000);
    expect(formatShortRelativeAgo(nowMs, twoMinutesAgoSec)).toBe('2m ago');
  });

  it('formats meshtastic last_heard in milliseconds', () => {
    expect(formatShortRelativeAgo(nowMs, nowMs - 120_000)).toBe('2m ago');
  });
});
