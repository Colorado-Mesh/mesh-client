import { describe, expect, it } from 'vitest';

import {
  resolveMeshcoreAdminHopsAway,
  resolveMeshcorePingHopsAway,
} from './meshcoreRepeaterAdminRouting';

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

describe('resolveMeshcorePingHopsAway', () => {
  it('keeps UI hops when the radio reports no route (0xFF) so direct-first/synth can run', () => {
    expect(
      resolveMeshcorePingHopsAway({
        node: { hops_away: 1 },
        routeBytes: new Uint8Array(),
        radioContactPathLen: -1,
        radioPathLeftover: false,
      }),
    ).toBe(1);
  });

  it('forces zero hops when the radio length byte says direct', () => {
    expect(
      resolveMeshcorePingHopsAway({
        node: { hops_away: 2 },
        routeBytes: undefined,
        radioContactPathLen: 0x40,
        radioPathLeftover: false,
      }),
    ).toBe(0);
  });

  it('treats a known empty companion route as direct when the radio length is not 0xFF', () => {
    expect(
      resolveMeshcorePingHopsAway({
        node: { hops_away: 1 },
        routeBytes: new Uint8Array(),
        radioContactPathLen: null,
        radioPathLeftover: false,
      }),
    ).toBe(0);
  });

  it('keeps multi-hop when the companion holds a route', () => {
    expect(
      resolveMeshcorePingHopsAway({
        node: { hops_away: 1 },
        routeBytes: new Uint8Array([0x06, 0x47, 0xce, 0xd2]),
        radioContactPathLen: 0x41,
        radioPathLeftover: false,
      }),
    ).toBe(1);
  });
});
