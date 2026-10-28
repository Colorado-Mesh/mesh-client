import { afterEach, describe, expect, it, vi } from 'vitest';

import * as appSettingsStorage from './appSettingsStorage';
import {
  GPS_SETTINGS_STORAGE_KEY,
  hasStoredStaticGps,
  overlayStoredStaticGpsOnSelfNode,
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
    vi.restoreAllMocks();
  });

  it('returns 0 when refreshInterval is missing or non-positive', () => {
    expect(readGpsRefreshIntervalSecs()).toBe(0);
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: 0 }));
    expect(readGpsRefreshIntervalSecs()).toBe(0);
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: -5 }));
    expect(readGpsRefreshIntervalSecs()).toBe(0);
  });

  it('returns a positive refresh interval when configured and explicitly enabled', () => {
    vi.spyOn(appSettingsStorage, 'isShareMyLocationEnabled').mockReturnValue(true);
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: 30 }));
    expect(readGpsRefreshIntervalSecs()).toBe(30);
  });

  it('returns 0 refresh interval when shareMyLocation is disabled', () => {
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: 900 }));
    vi.spyOn(appSettingsStorage, 'isShareMyLocationEnabled').mockReturnValue(false);
    expect(readGpsRefreshIntervalSecs()).toBe(0);
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

describe('overlayStoredStaticGpsOnSelfNode', () => {
  afterEach(() => {
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
  });

  it('overlays static coords onto the self node when stored', () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 41.59375, staticLon: -73.02428 }),
    );
    const map = new Map([
      [0x42, { latitude: 40.0, longitude: -74.0 }],
      [0x99, { latitude: 39.0, longitude: -105.0 }],
    ]);
    overlayStoredStaticGpsOnSelfNode(map, 0x42);
    expect(map.get(0x42)).toEqual({ latitude: 41.59375, longitude: -73.02428 });
    expect(map.get(0x99)).toEqual({ latitude: 39.0, longitude: -105.0 });
  });

  it('is a no-op without static GPS or when self is missing', () => {
    const map = new Map([[0x42, { latitude: 40.0, longitude: -74.0 }]]);
    overlayStoredStaticGpsOnSelfNode(map, 0x42);
    expect(map.get(0x42)).toEqual({ latitude: 40.0, longitude: -74.0 });
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ staticLat: 1, staticLon: 2 }));
    overlayStoredStaticGpsOnSelfNode(map, 0x99);
    expect(map.get(0x42)).toEqual({ latitude: 40.0, longitude: -74.0 });
  });
});

describe('resolveOurPosition', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it('skips host GPS lookups when shareMyLocation is disabled', async () => {
    vi.spyOn(appSettingsStorage, 'isShareMyLocationEnabled').mockReturnValue(false);
    const getGpsFix = vi.fn();
    vi.stubGlobal('window', {
      electronAPI: { getGpsFix },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const p = await resolveOurPosition(undefined, undefined, undefined, undefined);
    expect(p).toBeNull();
    expect(getGpsFix).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
