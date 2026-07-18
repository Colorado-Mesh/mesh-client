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

/** Build the OSM map URL for a coordinate pair (local UI / outbound link). */
export function buildOsmMapUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${formatCoord(lat)}&mlon=${formatCoord(lon)}`;
}

/** Build the two-line shared-location text message (label is caller-localized). */
export function formatLocationMessage(lat: number, lon: number, label: string): string {
  const latStr = formatCoord(lat);
  const lonStr = formatCoord(lon);
  return `${label}: ${latStr}, ${lonStr}\n${buildOsmMapUrl(lat, lon)}`;
}

/**
 * Detect a shared-location message.
 * Prefer the locale-independent OSM `mlat`/`mlon` URL (two-line wire form),
 * then fall back to a labeled `lat, lon` pair (`Label: 40.1, -105.0`).
 * Uses string/URLSearchParams parsing (no nested-quantifier regex).
 */
export function parseLocationMessage(text: string): ParsedLocationMessage | null {
  if (!text) return null;
  const fromOsm = parseOsmLocationMessage(text);
  if (fromOsm) return fromOsm;
  return parseLabeledCoordLocationMessage(text);
}

function parseOsmLocationMessage(text: string): ParsedLocationMessage | null {
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
      return { lat: coords.lat, lon: coords.lon, mapUrl: buildOsmMapUrl(coords.lat, coords.lon) };
    }
    searchFrom = hostIdx + OSM_HOST_MARKER.length;
  }
  return null;
}

/**
 * Labeled coords form: `…: lat, lon` (optionally with trailing whitespace / more lines).
 * Requires a colon before the pair so bare "1, 2" chat does not false-positive.
 */
function parseLabeledCoordLocationMessage(text: string): ParsedLocationMessage | null {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const colon = line.lastIndexOf(':');
    if (colon < 0) continue;
    const after = line.slice(colon + 1).trim();
    const comma = after.indexOf(',');
    if (comma < 0) continue;
    const latToken = after.slice(0, comma).trim();
    const lonToken = after.slice(comma + 1).trim();
    if (!isExactNumberToken(latToken) || !isExactNumberToken(lonToken)) continue;
    const lat = Number.parseFloat(latToken);
    const lon = Number.parseFloat(lonToken);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    return { lat, lon, mapUrl: buildOsmMapUrl(lat, lon) };
  }
  return null;
}

/** True when `s` is exactly one finite number (no trailing junk). */
function isExactNumberToken(s: string): boolean {
  if (!s) return false;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return false;
  // Number.parseFloat stops at the first non-numeric char — reject leftovers.
  let i = 0;
  if (s.startsWith('+') || s.startsWith('-')) i = 1;
  let sawDigit = false;
  while (i < s.length && s.charAt(i) >= '0' && s.charAt(i) <= '9') {
    sawDigit = true;
    i += 1;
  }
  if (i < s.length && s.charAt(i) === '.') {
    i += 1;
    while (i < s.length && s.charAt(i) >= '0' && s.charAt(i) <= '9') {
      sawDigit = true;
      i += 1;
    }
  }
  if (!sawDigit) return false;
  if (i < s.length && (s.charAt(i) === 'e' || s.charAt(i) === 'E')) {
    let j = i + 1;
    if (j < s.length && (s.charAt(j) === '+' || s.charAt(j) === '-')) j += 1;
    let expDigit = false;
    while (j < s.length && s.charAt(j) >= '0' && s.charAt(j) <= '9') {
      expDigit = true;
      j += 1;
    }
    if (!expDigit) return false;
    i = j;
  }
  return i === s.length;
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
