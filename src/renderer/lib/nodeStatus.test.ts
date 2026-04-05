import { describe, expect, it } from 'vitest';

import {
  getNodeStatus,
  lastHeardToUnixSeconds,
  mergeMeshcoreLastHeardFromAdvert,
  normalizeLastHeardMs,
} from './nodeStatus';

describe('lastHeardToUnixSeconds', () => {
  it('returns 0 for invalid input', () => {
    expect(lastHeardToUnixSeconds(0)).toBe(0);
    expect(lastHeardToUnixSeconds(NaN)).toBe(0);
  });

  it('treats values below 1e12 as epoch seconds', () => {
    expect(lastHeardToUnixSeconds(1_700_000_000)).toBe(1_700_000_000);
  });

  it('treats values at or above 1e12 as epoch milliseconds', () => {
    expect(lastHeardToUnixSeconds(1_700_000_000_000)).toBe(1_700_000_000);
  });
});

describe('mergeMeshcoreLastHeardFromAdvert', () => {
  it('returns the more recent of device lastAdvert and previous last_heard', () => {
    // previous is newer than device advert — live event must win
    expect(mergeMeshcoreLastHeardFromAdvert(1_700_000_100, 1_700_000_500)).toBe(1_700_000_500);
    // device advert is newer
    expect(mergeMeshcoreLastHeardFromAdvert(1_700_000_500, 1_700_000_100)).toBe(1_700_000_500);
  });

  it('preserves previous last_heard when device advert is 0', () => {
    expect(mergeMeshcoreLastHeardFromAdvert(0, 1_700_000_200)).toBe(1_700_000_200);
  });

  it('preserves previous last_heard in ms when device advert is missing', () => {
    const prevMs = 1_700_000_200_000;
    expect(mergeMeshcoreLastHeardFromAdvert(undefined, prevMs)).toBe(1_700_000_200);
  });

  it('returns 0 when both are empty', () => {
    expect(mergeMeshcoreLastHeardFromAdvert(0, 0)).toBe(0);
    expect(mergeMeshcoreLastHeardFromAdvert(null, undefined)).toBe(0);
  });

  it('aligns with normalizeLastHeardMs for UI freshness', () => {
    const merged = mergeMeshcoreLastHeardFromAdvert(0, 1_700_000_000);
    expect(normalizeLastHeardMs(merged)).toBe(1_700_000_000_000);
  });
});

describe('getNodeStatus', () => {
  it('returns offline for invalid input', () => {
    expect(getNodeStatus(0)).toBe('offline');
    expect(getNodeStatus(NaN)).toBe('offline');
  });

  it('uses default thresholds when not provided', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000 + 1000;
    expect(getNodeStatus(twoHoursAgo)).toBe('online');
  });

  it('uses custom thresholds when provided', () => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const staleThreshold = 24 * 60 * 60 * 1000;
    const offlineThreshold = 48 * 60 * 60 * 1000;

    expect(getNodeStatus(oneHourAgo, staleThreshold, offlineThreshold)).toBe('online');
  });

  it('MeshCore thresholds: online <= 48h, stale > 48h <= 96h, offline > 96h', () => {
    const meshcoreStale = 48 * 60 * 60 * 1000;
    const meshcoreOffline = 96 * 60 * 60 * 1000;

    const exactly48hAgo = Date.now() - meshcoreStale + 1000;
    expect(getNodeStatus(exactly48hAgo, meshcoreStale, meshcoreOffline)).toBe('online');

    const oneSecondOver48h = Date.now() - meshcoreStale - 1000;
    expect(getNodeStatus(oneSecondOver48h, meshcoreStale, meshcoreOffline)).toBe('stale');

    const exactly96hAgo = Date.now() - meshcoreOffline + 1000;
    expect(getNodeStatus(exactly96hAgo, meshcoreStale, meshcoreOffline)).toBe('stale');

    const oneSecondOver96h = Date.now() - meshcoreOffline - 1000;
    expect(getNodeStatus(oneSecondOver96h, meshcoreStale, meshcoreOffline)).toBe('offline');
  });

  it('Meshtastic thresholds: online <= 2h, stale > 2h <= 7d, offline > 7d', () => {
    const meshtasticStale = 2 * 60 * 60 * 1000;
    const meshtasticOffline = 7 * 24 * 60 * 60 * 1000;

    const exactly2hAgo = Date.now() - meshtasticStale + 1000;
    expect(getNodeStatus(exactly2hAgo, meshtasticStale, meshtasticOffline)).toBe('online');

    const oneSecondOver2h = Date.now() - meshtasticStale - 1000;
    expect(getNodeStatus(oneSecondOver2h, meshtasticStale, meshtasticOffline)).toBe('stale');

    const exactly7dAgo = Date.now() - meshtasticOffline + 1000;
    expect(getNodeStatus(exactly7dAgo, meshtasticStale, meshtasticOffline)).toBe('stale');

    const oneSecondOver7d = Date.now() - meshtasticOffline - 1000;
    expect(getNodeStatus(oneSecondOver7d, meshtasticStale, meshtasticOffline)).toBe('offline');
  });
});
