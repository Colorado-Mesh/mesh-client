export type GpsSource = 'device' | 'browser' | 'ip' | 'static';

/** Sources that provide only city-level (~10–50 km) accuracy (browser WiFi/IP positioning included) */
export const LOW_ACCURACY_SOURCES: ReadonlySet<GpsSource> = new Set(['ip', 'browser']);

export function isLowAccuracyPosition(source: GpsSource): boolean {
  return LOW_ACCURACY_SOURCES.has(source);
}

export interface OurPosition {
  lat: number;
  lon: number;
  source: GpsSource;
}

/**
 * GPS waterfall: device coords → static override → browser geolocation → IP geolocation → null.
 */
export async function resolveOurPosition(
  deviceLat?: number | null,
  deviceLon?: number | null,
  staticLat?: number,
  staticLon?: number,
): Promise<OurPosition | null> {
  // 1. Device GPS — use if clearly non-zero
  if (
    deviceLat != null &&
    deviceLon != null &&
    (Math.abs(deviceLat) > 0.0001 || Math.abs(deviceLon) > 0.0001)
  ) {
    return { lat: deviceLat, lon: deviceLon, source: 'device' };
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

  // 3. Native OS geolocation via main process (bypasses Chromium permission issues)
  if (typeof window !== 'undefined' && (window as any).electronAPI?.getGpsFix) {
    try {
      const result = await (window as any).electronAPI.getGpsFix();
      if (
        result.status !== 'error' &&
        !('error' in result) &&
        typeof result.lat === 'number' &&
        typeof result.lon === 'number' &&
        Number.isFinite(result.lat) &&
        Number.isFinite(result.lon)
      ) {
        const mappedSource: GpsSource = result.source === 'ip' ? 'ip' : 'browser';
        return { lat: result.lat, lon: result.lon, source: mappedSource };
      }
    } catch (e) {
      console.debug('[gpsSource] getGpsFix failed, fall through', e);
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
      const data = await res.json();
      if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        return { lat: data.latitude, lon: data.longitude, source: 'ip' };
      }
    }
  } catch (e) {
    console.debug('[gpsSource] ipapi fetch failed, fall through', e);
  }

  return null;
}
