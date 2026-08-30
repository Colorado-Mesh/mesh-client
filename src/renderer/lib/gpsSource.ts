import { isShareMyLocationEnabled } from '@/renderer/lib/appSettingsStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';

export const GPS_SETTINGS_STORAGE_KEY = 'mesh-client:gpsSettings';

export type GpsSource = 'device' | 'browser' | 'ip' | 'static';

interface StoredGpsSettings {
  staticLat?: number;
  staticLon?: number;
  refreshInterval?: number;
}

function readStoredGpsSettings(): StoredGpsSettings {
  if (typeof localStorage === 'undefined') return {};
  return (
    parseStoredJson<StoredGpsSettings>(
      localStorage.getItem(GPS_SETTINGS_STORAGE_KEY),
      'gpsSource readStoredGpsSettings',
    ) ?? {}
  );
}

/** Host GPS poll interval in seconds (0 = disabled). Respects share-my-location privacy. */
export function readGpsRefreshIntervalSecs(): number {
  if (!isShareMyLocationEnabled()) return 0;
  const interval = readStoredGpsSettings().refreshInterval;
  return typeof interval === 'number' && Number.isFinite(interval) && interval > 0 ? interval : 0;
}

/** Persist static coordinates while preserving other GPS settings keys. */
export function persistStoredStaticGps(lat: number, lon: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const existing = readStoredGpsSettings();
    const refreshInterval =
      typeof existing.refreshInterval === 'number' ? existing.refreshInterval : 0;
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...existing, staticLat: lat, staticLon: lon, refreshInterval }),
    );
  } catch {
    // catch-no-log-ok localStorage quota or private mode
  }
}

/** User-configured static coordinates from App tab GPS settings. */
export function readStoredStaticGps(): { lat: number; lon: number } | null {
  const s = readStoredGpsSettings();
  const { staticLat: lat, staticLon: lon } = s;
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    return { lat, lon };
  }
  return null;
}

export function hasStoredStaticGps(): boolean {
  return readStoredStaticGps() != null;
}

/** When true, RF/advert position for the connected self-node must not overwrite app static GPS. */
export function shouldPreserveStaticGpsForSelfNode(nodeId: number, selfNodeId: number): boolean {
  return selfNodeId > 0 && nodeId === selfNodeId && hasStoredStaticGps();
}

/** Sources that provide only city-level (~10–50 km) accuracy (browser WiFi/IP positioning included) */
export const LOW_ACCURACY_SOURCES: ReadonlySet<GpsSource> = new Set(['ip', 'browser']);

export function isLowAccuracyPosition(source: GpsSource): boolean {
  return LOW_ACCURACY_SOURCES.has(source);
}

export interface OurPosition {
  lat: number;
  lon: number;
  source: GpsSource;
  /** Device-reported altitude in meters, when the radio path provided it. */
  altitudeMeters?: number;
}

/**
 * GPS waterfall: device coords → static override → browser geolocation → IP geolocation → null.
 */
export async function resolveOurPosition(
  deviceLat?: number | null,
  deviceLon?: number | null,
  staticLat?: number,
  staticLon?: number,
  deviceAltMeters?: number | null,
): Promise<OurPosition | null> {
  // 1. Device GPS — use if clearly non-zero
  if (
    deviceLat != null &&
    deviceLon != null &&
    (Math.abs(deviceLat) > 0.0001 || Math.abs(deviceLon) > 0.0001)
  ) {
    const out: OurPosition = { lat: deviceLat, lon: deviceLon, source: 'device' };
    if (typeof deviceAltMeters === 'number' && Number.isFinite(deviceAltMeters)) {
      out.altitudeMeters = deviceAltMeters;
    }
    return out;
  }

  // 2. Static position — user-configured override (skips browser/IP lookup)
  if (
    staticLat != null &&
    staticLon != null &&
    Number.isFinite(staticLat) &&
    Number.isFinite(staticLon)
  ) {
    return { lat: staticLat, lon: staticLon, source: 'static' };
  }

  // 3–4. Host GPS — skipped when user disabled share-my-location (privacy)
  if (!isShareMyLocationEnabled()) {
    return null;
  }

  // 3. Native OS geolocation via main process (bypasses Chromium permission issues)
  if (typeof window !== 'undefined') {
    try {
      const result = await window.electronAPI.getGpsFix();
      if (
        !('status' in result) &&
        typeof result.lat === 'number' &&
        typeof result.lon === 'number' &&
        Number.isFinite(result.lat) &&
        Number.isFinite(result.lon)
      ) {
        const mappedSource: GpsSource = result.source === 'ip' ? 'ip' : 'browser';
        return { lat: result.lat, lon: result.lon, source: mappedSource };
      }
    } catch (e) {
      console.debug('[gpsSource] getGpsFix failed, fall through ' + errLikeToLogString(e));
    }
  }

  // 4. IP-based geolocation (city-level, no API key required)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 5000);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data: unknown = await res.json();
      if (
        typeof data === 'object' &&
        data != null &&
        'latitude' in data &&
        'longitude' in data &&
        typeof data.latitude === 'number' &&
        typeof data.longitude === 'number'
      ) {
        return { lat: data.latitude, lon: data.longitude, source: 'ip' };
      }
    }
  } catch (e) {
    console.debug('[gpsSource] ipapi fetch failed, fall through ' + errLikeToLogString(e));
  }

  return null;
}
