import { toPoint as mgrsToPoint } from 'mgrs';

export interface LatLon {
  lat: number;
  lon: number;
}

const NUMBER_TOKEN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const MGRS_COMPACT = /^\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{0,10})$/;
const DEGREE_MARKS = /[°º˚'′’‘"″”“]/g;

function inRange(lat: number, lon: number): LatLon | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function parseDecimalPair(text: string): LatLon | null {
  const parts = text
    .replace(DEGREE_MARKS, ' ')
    .split(/[\s,;]+/)
    .filter((p) => p.length > 0);
  if (parts.length !== 2 || !parts.every((p) => NUMBER_TOKEN.test(p))) return null;
  return inRange(Number(parts[0]), Number(parts[1]));
}

/** Degrees with optional minutes/seconds; sign comes from the degree token. */
function sexagesimal(tokens: string[], allowSign: boolean): number | null {
  if (tokens.length < 1 || tokens.length > 3) return null;
  if (!tokens.every((t) => NUMBER_TOKEN.test(t))) return null;
  const negative = tokens[0].startsWith('-');
  if (negative && !allowSign) return null;
  const [deg, min = 0, sec = 0] = tokens.map((t) => Math.abs(Number(t)));
  if (tokens.slice(1).some((t) => /^[+-]/.test(t))) return null;
  if (min >= 60 || sec >= 60) return null;
  if (tokens.length > 1 && !Number.isInteger(deg)) return null;
  if (tokens.length > 2 && !Number.isInteger(min)) return null;
  const value = deg + min / 60 + sec / 3600;
  return negative ? -value : value;
}

/**
 * Decimal, degrees-minutes or degrees-minutes-seconds, with optional N/S/E/W letters before or
 * after each value (Google/Apple Maps copy formats, GPS receivers, paper forms).
 */
function parseSexagesimalPair(text: string): LatLon | null {
  const tokens = text
    .toUpperCase()
    .replace(DEGREE_MARKS, ' ')
    .replace(/[NSEW]/g, ' $& ')
    .split(/[\s,;]+/)
    .filter((t) => t.length > 0);
  const isHemi = (t: string) => t === 'N' || t === 'S' || t === 'E' || t === 'W';
  const letterCount = tokens.filter(isHemi).length;

  if (letterCount === 0) {
    if (tokens.length !== 4 && tokens.length !== 6) return null;
    const half = tokens.length / 2;
    const lat = sexagesimal(tokens.slice(0, half), true);
    const lon = sexagesimal(tokens.slice(half), true);
    return lat == null || lon == null ? null : inRange(lat, lon);
  }
  if (letterCount !== 2) return null;

  const prefix = isHemi(tokens[0]);
  if (!prefix && !isHemi(tokens[tokens.length - 1])) return null;
  const groups: { hemi: string; nums: string[] }[] = [];
  if (prefix) {
    for (const token of tokens) {
      if (isHemi(token)) groups.push({ hemi: token, nums: [] });
      else groups[groups.length - 1].nums.push(token);
    }
  } else {
    let current: string[] = [];
    for (const token of tokens) {
      if (isHemi(token)) {
        groups.push({ hemi: token, nums: current });
        current = [];
      } else current.push(token);
    }
    if (current.length > 0) return null;
  }

  let lat: number | null = null;
  let lon: number | null = null;
  for (const { hemi, nums } of groups) {
    const value = sexagesimal(nums, false);
    if (value == null) return null;
    if (hemi === 'N' || hemi === 'S') {
      if (lat != null) return null;
      lat = hemi === 'S' ? -value : value;
    } else {
      if (lon != null) return null;
      lon = hemi === 'W' ? -value : value;
    }
  }
  return lat == null || lon == null ? null : inRange(lat, lon);
}

function parseMgrs(text: string): LatLon | null {
  const compact = text.replace(/\s+/g, '').toUpperCase();
  const match = MGRS_COMPACT.exec(compact);
  if (!match || match[1].length % 2 !== 0) return null;
  try {
    const [lon, lat] = mgrsToPoint(compact);
    return inRange(lat, lon);
  } catch {
    // catch-no-log-ok invalid MGRS grid square; caller shows the inline validation error
    return null;
  }
}

/** `geo:` URIs and map links (Google, Apple, OpenStreetMap, Bing). */
function parseMapLink(text: string): LatLon | null {
  if (/^geo:/i.test(text)) {
    return parseDecimalPair(text.slice(4).split(/[;?]/)[0]);
  }
  if (!/^https?:\/\//i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // catch-no-log-ok not a URL; fall through to plain coordinate formats
    return null;
  }
  const params = url.searchParams;
  const mlat = params.get('mlat');
  const mlon = params.get('mlon');
  if (mlat && mlon) {
    const pair = parseDecimalPair(`${mlat} ${mlon}`);
    if (pair) return pair;
  }
  for (const key of ['q', 'query', 'll', 'sll', 'center', 'daddr', 'destination', 'cp']) {
    const value = params.get(key)?.replace(/^loc:/i, '').replace('~', ',');
    const pair = value ? parseDecimalPair(value) : null;
    if (pair) return pair;
  }
  const at = url.pathname.indexOf('/@');
  if (at >= 0) {
    const [lat, lon] = url.pathname.slice(at + 2).split(',');
    const pair = lat && lon ? parseDecimalPair(`${lat} ${lon}`) : null;
    if (pair) return pair;
  }
  const hashMap = /map=[\d.]+\/(-?[\d.]+)\/(-?[\d.]+)/.exec(url.hash);
  if (hashMap) return parseDecimalPair(`${hashMap[1]} ${hashMap[2]}`);
  return null;
}

/**
 * Parse a pasted or typed location: decimal "lat, lon", DMS / DM with N/S/E/W, MGRS,
 * `geo:` URIs, or a map-app share link. Returns null when unrecognized or out of range.
 */
export function parseLatLonPair(text: string): LatLon | null {
  const trimmed = text.trim().replace(/^[([{]\s*|\s*[)\]}]$/g, '');
  if (!trimmed) return null;
  return (
    parseMapLink(trimmed) ??
    parseDecimalPair(trimmed) ??
    parseSexagesimalPair(trimmed) ??
    parseMgrs(trimmed)
  );
}
