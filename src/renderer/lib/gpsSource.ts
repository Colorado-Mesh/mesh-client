export type GpsSource = 'device' | 'browser' | 'ip';

export interface OurPosition {
  lat: number;
  lon: number;
  source: GpsSource;
}

/**
 * GPS waterfall: device coords → browser geolocation → IP geolocation → null.
 */
export async function resolveOurPosition(
  deviceLat?: number,
  deviceLon?: number,
): Promise<OurPosition | null> {
  // 1. Device GPS — use if clearly non-zero
  if (
    deviceLat != null &&
    deviceLon != null &&
    (Math.abs(deviceLat) > 0.0001 || Math.abs(deviceLon) > 0.0001)
  ) {
    return { lat: deviceLat, lon: deviceLon, source: 'device' };
  }

  // 2. Native OS geolocation via main process (bypasses Chromium permission issues)
  if (typeof window !== "undefined" && (window as any).electronAPI?.getGpsFix) {
    try {
      const result = await (window as any).electronAPI.getGpsFix();
      if (result.status !== "error" && !("error" in result)) {
        return { lat: result.lat, lon: result.lon, source: "browser" };
      }
    } catch {
      /* fall through */
    }
  }

  // 3. IP-based geolocation (city-level, no API key required)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        return { lat: data.latitude, lon: data.longitude, source: 'ip' };
      }
    }
  } catch {
    // network failure or abort — fall through
  }

  return null;
}
