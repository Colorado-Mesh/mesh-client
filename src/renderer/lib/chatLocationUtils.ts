/** Shared-location wire helpers for chat (plain text + OSM link; locale-independent parse). */

export interface ParsedLocationMessage {
  lat: number;
  lon: number;
  mapUrl: string;
}

export interface WebMercatorTile {
  x: number;
  y: number;
  z: number;
}

const OSM_HOST_MARKER = 'openstreetmap.org/?';

/** Build the two-line shared-location text message (label is caller-localized). */
export function formatLocationMessage(lat: number, lon: number, label: string): string {
  const latStr = formatCoord(lat);
  const lonStr = formatCoord(lon);
  const mapUrl = `https://www.openstreetmap.org/?mlat=${latStr}&mlon=${lonStr}`;
  return `${label}: ${latStr}, ${lonStr}\n${mapUrl}`;
}

/**
 * Detect a shared-location message via the locale-independent OSM `mlat`/`mlon` URL.
 * Uses string/URLSearchParams parsing (no nested-quantifier regex).
 */
export function parseLocationMessage(text: string): ParsedLocationMessage | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  let searchFrom = 0;
  while (searchFrom < lower.length) {
    const hostIdx = lower.indexOf(OSM_HOST_MARKER, searchFrom);
    if (hostIdx < 0) return null;
    // Walk back to find https?:// start of this URL.
    let urlStart = hostIdx;
    while (urlStart > 0) {
      const prev = text.charAt(urlStart - 1);
      if (/\s/.test(prev)) break;
      urlStart -= 1;
      if (hostIdx - urlStart > 16) break;
    }
    let urlEnd = hostIdx + OSM_HOST_MARKER.length;
    while (urlEnd < text.length) {
      const ch = text.charAt(urlEnd);
      if (/[\s<>"']/.test(ch)) break;
      urlEnd += 1;
      if (urlEnd - urlStart > 512) break;
    }
    const url = text.slice(urlStart, urlEnd);
    const coords = parseOsmMlatMlon(url);
    if (coords) {
      const mapUrl = `https://www.openstreetmap.org/?mlat=${formatCoord(coords.lat)}&mlon=${formatCoord(coords.lon)}`;
      return { lat: coords.lat, lon: coords.lon, mapUrl };
    }
    searchFrom = hostIdx + OSM_HOST_MARKER.length;
  }
  return null;
}

function parseOsmMlatMlon(url: string): { lat: number; lon: number } | null {
  const qIdx = url.indexOf('?');
  if (qIdx < 0) return null;
  const query = url.slice(qIdx + 1);
  let lat: number | null = null;
  let lon: number | null = null;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).toLowerCase();
    const raw = part.slice(eq + 1);
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) continue;
    if (key === 'mlat') lat = n;
    if (key === 'mlon') lon = n;
  }
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Standard Web Mercator tiling math for static tile URL. */
export function latLonToTile(lat: number, lon: number, zoom = 14): WebMercatorTile {
  const z = Math.max(0, Math.min(19, Math.floor(zoom)));
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
    z,
  };
}

/** OSM tile URL for a static preview (no API key; OSM tile usage policy applies). */
export function buildStaticTileUrl(lat: number, lon: number, zoom = 14): string {
  const { x, y, z } = latLonToTile(lat, lon, zoom);
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function formatCoord(n: number): string {
  // Trim trailing zeros while keeping enough precision for map pins.
  return Number(n.toFixed(6)).toString();
}
