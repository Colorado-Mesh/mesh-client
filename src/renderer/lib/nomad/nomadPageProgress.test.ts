import { describe, expect, it } from 'vitest';

import {
  asNomadPageProgressPayload,
  mapNomadPageProgress,
  nomadPageProgressMatchesLoad,
} from './nomadPageProgress';

describe('asNomadPageProgressPayload', () => {
  it('rejects null, non-objects, and non-string phase', () => {
    expect(asNomadPageProgressPayload(null)).toBeNull();
    expect(asNomadPageProgressPayload('link_attempt')).toBeNull();
    expect(
      asNomadPageProgressPayload({
        destination_hash: 'e7d84cefc1f9a8f9a80336f3fa2d2309',
        phase: 1,
      }),
    ).toBeNull();
  });

  it('accepts a valid payload and rejects wrong optional types', () => {
    expect(
      asNomadPageProgressPayload({
        destination_hash: 'e7d84cefc1f9a8f9a80336f3fa2d2309',
        path: '/page/index.mu',
        phase: 'link_attempt',
        request_id: '42',
        iface: 'Ratspeak',
        hops: 4,
      }),
    ).toEqual({
      destination_hash: 'e7d84cefc1f9a8f9a80336f3fa2d2309',
      path: '/page/index.mu',
      phase: 'link_attempt',
      request_id: '42',
      iface: 'Ratspeak',
      hops: 4,
    });
    expect(
      asNomadPageProgressPayload({
        destination_hash: 'e7d84cefc1f9a8f9a80336f3fa2d2309',
        phase: 'link_attempt',
        hops: '4',
      }),
    ).toBeNull();
  });
});

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

  it('maps link_attempt iface-only and generic fallbacks', () => {
    expect(mapNomadPageProgress({ phase: 'link_attempt', iface: 'Ratspeak' })).toEqual({
      messageKey: 'nomadNetwork.pageProgressLinkingIface',
      messageParams: { iface: 'Ratspeak' },
    });
    expect(mapNomadPageProgress({ phase: 'link_attempt' })).toEqual({
      messageKey: 'nomadNetwork.pageProgressLinkingGeneric',
      messageParams: {},
    });
  });

  it('maps dead route + failover with budget bump', () => {
    expect(mapNomadPageProgress({ phase: 'link_timeout', iface: 'Ratspeak' })).toEqual({
      messageKey: 'nomadNetwork.pageProgressDeadRoute',
      messageParams: { iface: 'Ratspeak' },
    });
    expect(mapNomadPageProgress({ phase: 'link_timeout' })).toEqual({
      messageKey: 'nomadNetwork.pageProgressDeadRouteGeneric',
      messageParams: {},
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

  it('maps searching_route and failover without iface', () => {
    expect(mapNomadPageProgress({ phase: 'searching_route' })).toEqual({
      messageKey: 'nomadNetwork.pageProgressSearchingRoute',
      messageParams: {},
    });
    expect(mapNomadPageProgress({ phase: 'failover', timeout_secs: 45 })).toEqual({
      messageKey: 'nomadNetwork.pageProgressFailoverGeneric',
      messageParams: {},
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

  it('requires matching request_id when provided', () => {
    const payload = {
      destination_hash: 'e7d84cefc1f9a8f9a80336f3fa2d2309',
      path: '/page/index.mu',
      phase: 'link_attempt',
      request_id: '7',
    };
    expect(
      nomadPageProgressMatchesLoad(
        payload,
        'e7d84cefc1f9a8f9a80336f3fa2d2309',
        '/page/index.mu',
        '7',
      ),
    ).toBe(true);
    expect(
      nomadPageProgressMatchesLoad(
        payload,
        'e7d84cefc1f9a8f9a80336f3fa2d2309',
        '/page/index.mu',
        '8',
      ),
    ).toBe(false);
  });
});
