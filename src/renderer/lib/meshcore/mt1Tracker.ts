import { isValidLatLon } from '@/shared/geoCoords';
import { isTakTrackerRole, type TakTrackerRole } from '@/shared/tak-types';

/** Compact tracker fix a MeshCoreTracker device posts to a channel. */
export interface Mt1Fix {
  callsign: string;
  /** Lowercase 8-hex tracker identity; stays the same when the callsign changes. */
  id8: string;
  role?: TakTrackerRole;
  lat: number;
  lon: number;
  /** Metres per second. */
  speed?: number;
  /** Degrees true. */
  course?: number;
  /** Metres. */
  altitude?: number;
  /** How long the fix stays valid, seconds. */
  staleSec?: number;
  seq?: number;
  /** Percent. */
  battery?: number;
}

export const MT1_PREFIX = '!MT1;';
const MT1_FIELD_MAX = 24;
const ID8_RE = /^[0-9a-fA-F]{8}$/;

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function inRange(n: number | undefined, min: number, max: number): number | undefined {
  return n !== undefined && n >= min && n <= max ? n : undefined;
}

function int(n: number | undefined, min: number, max: number): number | undefined {
  return n !== undefined && Number.isInteger(n) ? inRange(n, min, max) : undefined;
}

/**
 * Parse an `!MT1;` payload, e.g.
 * `!MT1;u=A1B2C3D4;k=k9;la=36.123456;ln=-82.123456;s=1.2;c=90;a=512;st=30;q=1042;b=87`.
 * Returns null for anything that is not a fix with a tracker id and a usable position.
 */
export function parseMt1Payload(payload: string, callsign: string): Mt1Fix | null {
  const text = payload.trim();
  if (!text.startsWith(MT1_PREFIX)) return null;
  const fields = new Map<string, string>();
  const parts = text.slice(MT1_PREFIX.length).split(';');
  if (parts.length > MT1_FIELD_MAX) return null;
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    fields.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }

  const id = fields.get('u');
  if (!id || !ID8_RE.test(id)) return null;
  const lat = num(fields.get('la'));
  const lon = num(fields.get('ln'));
  if (lat === undefined || lon === undefined || !isValidLatLon(lat, lon)) return null;
  if (lat === 0 && lon === 0) return null;

  const fix: Mt1Fix = {
    callsign: callsign.trim() || id.toUpperCase(),
    id8: id.toLowerCase(),
    lat,
    lon,
  };
  const role = fields.get('k')?.toLowerCase();
  if (role && isTakTrackerRole(role)) fix.role = role;
  const speed = inRange(num(fields.get('s')), 0, 1000);
  if (speed !== undefined) fix.speed = speed;
  const course = num(fields.get('c'));
  if (course !== undefined && course >= 0 && course < 360) fix.course = course;
  const altitude = inRange(num(fields.get('a')), -1000, 100_000);
  if (altitude !== undefined) fix.altitude = altitude;
  const staleSec = int(num(fields.get('st')), 1, 24 * 60 * 60);
  if (staleSec !== undefined) fix.staleSec = staleSec;
  const seq = int(num(fields.get('q')), 0, 0xffffffff);
  if (seq !== undefined) fix.seq = seq;
  const battery = int(num(fields.get('b')), 0, 100);
  if (battery !== undefined) fix.battery = battery;
  return fix;
}

/** Parse a whole channel line, `CALLSIGN: !MT1;...`. */
export function parseMt1Message(text: string): Mt1Fix | null {
  const sep = text.indexOf(': ');
  if (sep <= 0) return parseMt1Payload(text, '');
  return parseMt1Payload(text.slice(sep + 2), text.slice(0, sep));
}

/** CoT uid for a tracker: identity-based, so a renamed tracker keeps its marker. */
export function mt1StableUid(id8: string): string {
  return `meshtracker-${id8.toLowerCase()}`;
}
