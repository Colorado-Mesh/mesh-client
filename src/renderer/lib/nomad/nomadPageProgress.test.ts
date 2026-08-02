import { describe, expect, it } from 'vitest';

import { mapNomadPageProgress, nomadPageProgressMatchesLoad } from './nomadPageProgress';

describe('mapNomadPageProgress', () => {
  it('maps link_attempt with iface and hops', () => {
    expect(
      mapNomadPageProgress({
        phase: 'link_attempt',
        iface: 'Ratspeak',
        hops: 4,
      }),
    ).toEqual({
      messageKey: 'nomadNetwork.pageProgressLinking',
      messageParams: { iface: 'Ratspeak', hops: 4 },
    });
  });

  it('maps dead route + failover with budget bump', () => {
    expect(mapNomadPageProgress({ phase: 'link_timeout', iface: 'Ratspeak' })).toEqual({
      messageKey: 'nomadNetwork.pageProgressDeadRoute',
      messageParams: { iface: 'Ratspeak' },
    });
    expect(
      mapNomadPageProgress({
        phase: 'failover',
        iface: 'RNS_Transport_US-East',
        hops: 8,
        timeout_secs: 45,
      }),
    ).toEqual({
      messageKey: 'nomadNetwork.pageProgressFailover',
      messageParams: { iface: 'RNS_Transport_US-East', hops: 8 },
      addBudgetSecs: 45,
    });
  });

  it('maps no_alternate_route', () => {
    expect(mapNomadPageProgress({ phase: 'no_alternate_route' })).toEqual({
      messageKey: 'nomadNetwork.pageProgressNoAlternate',
      messageParams: {},
    });
  });

  it('returns null for unknown phase', () => {
    expect(mapNomadPageProgress({ phase: 'weird' })).toBeNull();
  });
});

describe('nomadPageProgressMatchesLoad', () => {
  it('requires matching hash and path', () => {
    const payload = {
      destination_hash: 'e7d84cefc1f9a8f9a80336f3fa2d2309',
      path: '/page/index.mu',
      phase: 'link_attempt',
    };
    expect(
      nomadPageProgressMatchesLoad(payload, 'e7d84cefc1f9a8f9a80336f3fa2d2309', '/page/index.mu'),
    ).toBe(true);
    expect(
      nomadPageProgressMatchesLoad(payload, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '/page/index.mu'),
    ).toBe(false);
    expect(
      nomadPageProgressMatchesLoad(payload, 'e7d84cefc1f9a8f9a80336f3fa2d2309', '/page/other.mu'),
    ).toBe(false);
  });
});
