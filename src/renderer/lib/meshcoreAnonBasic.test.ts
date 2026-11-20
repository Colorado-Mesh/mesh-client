import { describe, expect, it } from 'vitest';

import { meshcoreAnonBasicFromParsed, meshcoreAnonClockSkewSeconds } from './meshcoreAnonBasic';

describe('meshcoreAnonBasic', () => {
  it('maps parsed BASIC into a display entry', () => {
    expect(
      meshcoreAnonBasicFromParsed(
        {
          clock: 100,
          features: 0x81,
          isBridge: true,
          bridgeKind: 'uart',
          forwardingDisabled: true,
        },
        50,
      ),
    ).toEqual({
      status: 'ok',
      fetchedAt: 50,
      clock: 100,
      features: 0x81,
      isBridge: true,
      bridgeKind: 'uart',
      forwardingDisabled: true,
    });
  });

  it('computes clock skew in seconds', () => {
    expect(meshcoreAnonClockSkewSeconds(1_000, 1_000_000)).toBe(0);
    expect(meshcoreAnonClockSkewSeconds(1_010, 1_000_000)).toBe(10);
  });
});
