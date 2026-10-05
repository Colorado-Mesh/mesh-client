import { describe, expect, it } from 'vitest';

import { formatMeshtasticLinkStats } from './meshtasticLinkStats';

describe('formatMeshtasticLinkStats', () => {
  it('returns empty for transports without getLinkStats', () => {
    expect(formatMeshtasticLinkStats(undefined)).toBe('');
    expect(formatMeshtasticLinkStats(null)).toBe('');
    expect(formatMeshtasticLinkStats({})).toBe('');
  });

  it('formats counters and ages relative to now', () => {
    const transport = {
      getLinkStats: () => ({ rawBytes: 4096, lastRawAt: 9_000, frames: 37, lastFrameAt: 4_000 }),
    };
    expect(formatMeshtasticLinkStats(transport, 10_000)).toBe(
      ' rawBytes=4096 lastRawAgo=1000ms frames=37 lastFrameAgo=6000ms',
    );
  });

  it('reports never when no data or frames have arrived', () => {
    const transport = {
      getLinkStats: () => ({ rawBytes: 0, lastRawAt: null, frames: 0, lastFrameAt: null }),
    };
    expect(formatMeshtasticLinkStats(transport, 10_000)).toBe(
      ' rawBytes=0 lastRawAgo=never frames=0 lastFrameAgo=never',
    );
  });
});
