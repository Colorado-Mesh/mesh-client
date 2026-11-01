/**
 * User-confirmed custom map sources (XYZ tile servers + imported MBTiles packages).
 *
 * Security model: the `mesh-tiles:` host is only ever a source id. For XYZ sources the remote URL
 * template is validated here once, persisted by the main process after explicit user confirmation,
 * and only `{z}/{x}/{y}` are substituted at fetch time — a renderer can never supply a host.
 */

export type CustomMapSourceKind = 'xyz' | 'mbtiles';

/** `xyz-<12 hex>` / `mbtiles-<12 hex>`; valid as a URL hostname and safe as a directory name. */
export type CustomMapSourceId = `xyz-${string}` | `mbtiles-${string}`;

const CUSTOM_SOURCE_ID_RE = /^(xyz|mbtiles)-[a-f0-9]{12}$/;

export function isCustomMapSourceId(value: unknown): value is CustomMapSourceId {
  return typeof value === 'string' && CUSTOM_SOURCE_ID_RE.test(value);
}

export function customMapSourceKind(id: CustomMapSourceId): CustomMapSourceKind {
  return id.startsWith('mbtiles-') ? 'mbtiles' : 'xyz';
}

/** Public (renderer-safe) view of a source. Never includes the XYZ URL template (may hold keys). */
export interface CustomMapSourceInfo {
  id: CustomMapSourceId;
  kind: CustomMapSourceKind;
  name: string;
  /** Plain text. Escaped by the renderer before it reaches Leaflet's HTML attribution control. */
  attribution: string;
  addedAt: number;
  /** XYZ only: host the user confirmed. */
  host?: string;
  /** Highest zoom the source serves; Leaflet overzooms above it. */
  maxNativeZoom?: number;
  /** MBTiles only. */
  minZoom?: number;
  /** MBTiles only: size of the imported package on disk. */
  fileBytes?: number;
}

export type CustomMapSourceErrorCode =
  | XyzTemplateErrorCode
  | 'not_confirmed'
  | 'name'
  | 'attribution'
  | 'zoom'
  | 'limit'
  | 'unknown_inspect'
  | 'mbtiles_invalid'
  | 'mbtiles_vector'
  | 'mbtiles_too_large'
  | 'io';

export type CustomMapSourceResult =
  { ok: true; source: CustomMapSourceInfo } | { ok: false; code: CustomMapSourceErrorCode };

export type MbtilesPickResult =
  | {
      ok: true;
      inspectId: string;
      name: string;
      attribution: string;
      format: 'png' | 'jpg' | 'webp';
      minZoom: number;
      maxZoom: number;
      fileBytes: number;
    }
  | { ok: false; code: 'cancelled' | CustomMapSourceErrorCode };

export interface AddXyzSourceRequest {
  name: string;
  urlTemplate: string;
  attribution: string;
  maxNativeZoom?: number;
  /** Must be `true`: the user confirmed they may use this server and attribution is accurate. */
  confirmed: boolean;
}

export interface ImportMbtilesRequest {
  inspectId: string;
  name: string;
  attribution: string;
  confirmed: boolean;
}

export const CUSTOM_MAP_SOURCES_MAX = 16;
export const CUSTOM_SOURCE_NAME_MAX = 60;
export const CUSTOM_SOURCE_ATTRIBUTION_MAX = 200;
export const CUSTOM_XYZ_TEMPLATE_MAX = 2048;
export const CUSTOM_MAP_MAX_ZOOM = 22;
/** Per XYZ source view-cache cap (oldest tiles evicted first); the global cache cap still applies. */
export const CUSTOM_SOURCE_CACHE_MAX_BYTES = 256 * 1024 * 1024;
/** Largest single tile accepted from a custom XYZ server. */
export const CUSTOM_TILE_MAX_BYTES = 2 * 1024 * 1024;
/** Largest MBTiles package that can be imported (copied into userData). */
export const MBTILES_MAX_BYTES = 2 * 1024 * 1024 * 1024;

// ── Text sanitizing ──────────────────────────────────────────────────────────

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

function sanitizeLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = stripControlChars(value).replace(/\s+/g, ' ').trim();
  if (clean.length === 0 || clean.length > max) return null;
  return clean;
}

export function sanitizeCustomSourceName(value: unknown): string | null {
  return sanitizeLabel(value, CUSTOM_SOURCE_NAME_MAX);
}

/** Attribution is required (providers' terms demand it) and stored as plain text. */
export function sanitizeCustomSourceAttribution(value: unknown): string | null {
  return sanitizeLabel(value, CUSTOM_SOURCE_ATTRIBUTION_MAX);
}

export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML for Leaflet's `attribution` option from stored plain-text attribution. */
export function customAttributionToHtml(attribution: string): string {
  return escapeHtmlText(attribution);
}

export function isValidCustomMaxNativeZoom(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= CUSTOM_MAP_MAX_ZOOM
  );
}

// ── Host / address policy ────────────────────────────────────────────────────

const BLOCKED_HOST_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.lan',
  '.home',
  '.corp',
  '.intranet',
  '.test',
  '.invalid',
  '.example',
] as const;

function isOsmHost(host: string): boolean {
  return host === 'openstreetmap.org' || host.endsWith('.openstreetmap.org');
}

/** True for loopback / private / link-local / multicast / unspecified IPv4 and IPv6 addresses. */
export function isPrivateOrLocalAddress(address: string): boolean {
  const ip = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped?.[1]) return isPrivateOrLocalAddress(mapped[1]);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    return false;
  }
  if (ip.includes(':')) {
    if (ip === '::' || ip === '::1') return true;
    if (/^f[cd]/.test(ip)) return true; // fc00::/7 unique local
    if (/^fe[89ab]/.test(ip)) return true; // fe80::/10 link-local
    if (ip.startsWith('ff')) return true; // multicast
    return false;
  }
  return false;
}

// ── XYZ URL template validation ──────────────────────────────────────────────

export type XyzTemplateErrorCode =
  | 'empty'
  | 'too_long'
  | 'placeholders'
  | 'scheme'
  | 'credentials'
  | 'host'
  | 'port'
  | 'osm'
  | 'invalid';

export type XyzTemplateValidation =
  { ok: true; host: string; template: string } | { ok: false; code: XyzTemplateErrorCode };

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Validate a user-supplied XYZ template. Requirements: `https://` only, a public DNS hostname
 * (no IP literals, localhost or intranet suffixes, no userinfo, default port), exactly one each of
 * `{z}` `{x}` `{y}` placed after the host, no other `{}` tokens, no fragment, and not an
 * OpenStreetMap host (use the built-in basemap; OSM bulk/prefetch is policy-restricted).
 */
export function validateXyzTemplate(input: unknown): XyzTemplateValidation {
  if (typeof input !== 'string') return { ok: false, code: 'invalid' };
  const template = input.trim();
  if (template.length === 0) return { ok: false, code: 'empty' };
  if (template.length > CUSTOM_XYZ_TEMPLATE_MAX) return { ok: false, code: 'too_long' };
  // Any control char / whitespace is never legitimate in a tile URL.
  for (let i = 0; i < template.length; i += 1) {
    const code = template.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return { ok: false, code: 'invalid' };
  }
  if (!/^https:\/\//i.test(template)) return { ok: false, code: 'scheme' };
  if (template.includes('#')) return { ok: false, code: 'invalid' };

  for (const token of ['{z}', '{x}', '{y}']) {
    if (countOccurrences(template, token) !== 1) return { ok: false, code: 'placeholders' };
  }
  const stripped = template.replace('{z}', '').replace('{x}', '').replace('{y}', '');
  if (/[{}]/.test(stripped)) return { ok: false, code: 'placeholders' };

  // Placeholders must live in the path/query, never in scheme/userinfo/host/port.
  const pathStart = template.indexOf('/', 'https://'.length);
  const firstBrace = Math.min(...['{z}', '{x}', '{y}'].map((t) => template.indexOf(t)));
  if (pathStart === -1 || firstBrace < pathStart) return { ok: false, code: 'placeholders' };

  let parsed: URL;
  try {
    parsed = new URL(template.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'));
  } catch {
    // catch-no-log-ok invalid user input → typed error code
    return { ok: false, code: 'invalid' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, code: 'scheme' };
  if (parsed.username !== '' || parsed.password !== '') return { ok: false, code: 'credentials' };
  if (parsed.port !== '') return { ok: false, code: 'port' };

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (host.length === 0 || host.includes(':') || host.startsWith('[')) {
    return { ok: false, code: 'host' };
  }
  if (/^[\d.]+$/.test(host)) return { ok: false, code: 'host' }; // IPv4 / numeric shorthand
  if (!host.includes('.') || host === 'localhost') return { ok: false, code: 'host' };
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return { ok: false, code: 'host' };
  }
  if (isOsmHost(host)) return { ok: false, code: 'osm' };

  return { ok: true, host, template };
}

/** Substitute tile coordinates into a template previously accepted by {@link validateXyzTemplate}. */
export function buildCustomRemoteTileUrl(
  template: string,
  z: number,
  x: number,
  y: number,
): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

// ── Image sniffing (shared by protocol + MBTiles import) ────────────────────

export type RasterTileMime = 'image/png' | 'image/jpeg' | 'image/webp';

/** Detect a raster tile format from magic bytes; `null` for anything else (vector, HTML, JSON…). */
export function sniffRasterTileMime(data: Uint8Array): RasterTileMime | null {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 && // R
    data[1] === 0x49 && // I
    data[2] === 0x46 && // F
    data[3] === 0x46 && // F
    data[8] === 0x57 && // W
    data[9] === 0x45 && // E
    data[10] === 0x42 && // B
    data[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}
