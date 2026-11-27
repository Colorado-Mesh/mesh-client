/**
 * Mobile replacement for `src/main/gps.ts` (swapped in by `scripts/build-mobile-host.mjs`).
 * `gps:getFix` prefers the phone's own location (Capacitor Geolocation: GNSS + network fused,
 * reported as source `native`) and falls back to the desktop IP geolocation when location
 * permission is denied or no fix arrives in time.
 */
import { getGpsFix as getIpGpsFix, type GpsFix, type GpsFixResult } from '../../../main/gps';
import { callNative } from '../hostChannel';

export {
  type GpsFix,
  type GpsFixError,
  type GpsFixResult,
  type GpsFixSource,
  GpsHardwareError,
  shouldUseWifiNetworksPreflight,
} from '../../../main/gps';

const FIX_TIMEOUT_MS = 15_000;
const MAX_FIX_AGE_MS = 60_000;

interface NativePosition {
  coords: { latitude: number; longitude: number; accuracy?: number };
}

/** Phone location fix, or null when unavailable (permission denied, no signal, timeout). */
export async function getNativeFix(): Promise<GpsFix | null> {
  try {
    let perm = await callNative<{ location?: string; coarseLocation?: string }>(
      'Geolocation',
      'checkPermissions',
    );
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      perm = await callNative('Geolocation', 'requestPermissions', {
        permissions: ['location', 'coarseLocation'],
      });
    }
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
    const pos = await callNative<NativePosition>('Geolocation', 'getCurrentPosition', {
      enableHighAccuracy: true,
      timeout: FIX_TIMEOUT_MS,
      maximumAge: MAX_FIX_AGE_MS,
    });
    const { latitude, longitude } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { lat: latitude, lon: longitude, source: 'native' };
  } catch (e) {
    console.debug(
      `[gps-mobile] native fix unavailable: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

export async function getGpsFix(): Promise<GpsFixResult> {
  const native = await getNativeFix();
  if (native) return native;
  return getIpGpsFix();
}
