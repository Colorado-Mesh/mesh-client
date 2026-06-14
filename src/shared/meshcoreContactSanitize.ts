import { isValidLatLon } from './geoCoords';
import { isPlausibleMeshcoreLastAdvertSec } from './meshcoreLastAdvertPlausible';

/** Normalize `last_advert` for SQLite — reject uptime / corrupt values. */
export function sanitizeMeshcoreLastAdvertForDb(
  lastAdvert: number | null | undefined,
): number | null {
  if (lastAdvert == null || !Number.isFinite(lastAdvert)) return null;
  const sec = Math.floor(lastAdvert);
  return isPlausibleMeshcoreLastAdvertSec(sec) ? sec : null;
}

/** Drop out-of-range WGS84 contact coordinates before persist/hydration. */
export function sanitizeMeshcoreAdvLatLonForDb(
  lat: number | null | undefined,
  lon: number | null | undefined,
): { adv_lat: number | null; adv_lon: number | null } {
  if (!isValidLatLon(lat, lon)) {
    return { adv_lat: null, adv_lon: null };
  }
  return { adv_lat: lat!, adv_lon: lon! };
}

/** Display label for MeshCore contacts (nickname → adv_name → hex fallback). */
export function meshcoreContactDisplayName(
  nodeId: number,
  advName?: string | null,
  nickname?: string | null,
): string {
  const nick = nickname?.trim();
  if (nick) return nick;
  const name = advName?.trim();
  if (name) return name;
  return `Node-${nodeId.toString(16).toUpperCase()}`;
}
