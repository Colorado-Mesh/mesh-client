import { describe, expect, it } from 'vitest';

import { resolveMeshcoreAdminHopsAway } from './meshcoreRepeaterAdminRouting';

describe('resolveMeshcoreAdminHopsAway', () => {
  it.each([0, 1, 3])(
    'treats a known empty companion route as direct despite UI hops %s',
    (hops) => {
      expect(resolveMeshcoreAdminHopsAway({ hops_away: hops }, new Uint8Array())).toBe(0);
    },
  );

  it('infers a multi-hop route when the displayed hop count is zero', () => {
    expect(resolveMeshcoreAdminHopsAway({ hops_away: 0 }, new Uint8Array([0x11, 0x22]))).toBe(1);
  });

  it('preserves the displayed multi-hop fallback before a companion route is known', () => {
    expect(resolveMeshcoreAdminHopsAway({ hops_away: 3 }, undefined)).toBe(3);
  });

  it.each([undefined, NaN, -1])('defaults invalid or unknown UI hops %s to direct', (hops) => {
    expect(resolveMeshcoreAdminHopsAway({ hops_away: hops }, undefined)).toBe(0);
  });
});
