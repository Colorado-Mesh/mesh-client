import { afterEach, describe, expect, it } from 'vitest';

import {
  GPS_SETTINGS_STORAGE_KEY,
  hasStoredStaticGps,
  persistStoredStaticGps,
  readGpsRefreshIntervalSecs,
  readStoredStaticGps,
  resolveOurPosition,
  shouldPreserveStaticGpsForSelfNode,
} from './gpsSource';

describe('readStoredStaticGps', () => {
  afterEach(() => {
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
  });

  it('returns null when unset or invalid', () => {
    expect(readStoredStaticGps()).toBeNull();
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ staticLat: 'bad' }));
    expect(readStoredStaticGps()).toBeNull();
  });

  it('returns finite lat/lon when configured', () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 39.7392, staticLon: -104.9903 }),
    );
    expect(readStoredStaticGps()).toEqual({ lat: 39.7392, lon: -104.9903 });
    expect(hasStoredStaticGps()).toBe(true);
  });
});

describe('readGpsRefreshIntervalSecs / persistStoredStaticGps', () => {
  afterEach(() => {
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
  });

  it('returns 0 when refreshInterval is missing or non-positive', () => {
    expect(readGpsRefreshIntervalSecs()).toBe(0);
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: 0 }));
    expect(readGpsRefreshIntervalSecs()).toBe(0);
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: -5 }));
    expect(readGpsRefreshIntervalSecs()).toBe(0);
  });

  it('returns a positive refresh interval when configured', () => {
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: 30 }));
    expect(readGpsRefreshIntervalSecs()).toBe(30);
  });

  it('persists static coords while preserving refreshInterval', () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ refreshInterval: 45, extra: 'keep' }),
    );
    persistStoredStaticGps(39.1, -104.2);
    const stored = JSON.parse(localStorage.getItem(GPS_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(stored).toMatchObject({
      staticLat: 39.1,
      staticLon: -104.2,
      refreshInterval: 45,
      extra: 'keep',
    });
    expect(readStoredStaticGps()).toEqual({ lat: 39.1, lon: -104.2 });
  });
});

describe('shouldPreserveStaticGpsForSelfNode', () => {
  afterEach(() => {
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
  });

  it('is false without static GPS or for remote nodes', () => {
    expect(shouldPreserveStaticGpsForSelfNode(0xabc, 0xabc)).toBe(false);
    expect(shouldPreserveStaticGpsForSelfNode(0xabc, 0xdef)).toBe(false);
  });

  it('is true for self node when static GPS is stored', () => {
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ staticLat: 1, staticLon: 2 }));
    expect(shouldPreserveStaticGpsForSelfNode(0x42, 0x42)).toBe(true);
  });
});

describe('resolveOurPosition', () => {
  it('includes altitudeMeters on device branch when finite', async () => {
    const p = await resolveOurPosition(40.1, -105.1, undefined, undefined, 1600);
    expect(p).toEqual({
      lat: 40.1,
      lon: -105.1,
      source: 'device',
      altitudeMeters: 1600,
    });
  });

  it('omits altitude when deviceAlt is not finite', async () => {
    const p = await resolveOurPosition(40.1, -105.1, undefined, undefined, NaN);
    expect(p).toEqual({ lat: 40.1, lon: -105.1, source: 'device' });
    expect(p?.altitudeMeters).toBeUndefined();
  });

  it('includes sea-level altitude (0)', async () => {
    const p = await resolveOurPosition(40.1, -105.1, undefined, undefined, 0);
    expect(p?.altitudeMeters).toBe(0);
  });

  it('prefers device coords over static when device coords are provided', async () => {
    const p = await resolveOurPosition(40.1, -105.1, 39.0, -106.0);
    expect(p?.source).toBe('device');
  });

  it('uses static when device coords are omitted', async () => {
    const p = await resolveOurPosition(undefined, undefined, 39.7392, -104.9903);
    expect(p).toEqual({ lat: 39.7392, lon: -104.9903, source: 'static' });
  });
});
