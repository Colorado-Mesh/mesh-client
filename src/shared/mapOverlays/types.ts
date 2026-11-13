/**
 * Local KML / KMZ / GeoJSON vector overlays for MeshMapShell maps.
 * v1: local files only — no network KML URLs, no ground-overlay imagery, no full style fidelity.
 */

/** `overlay-<12 hex>`; safe as a directory / file stem. */
export type MapVectorOverlayId = `overlay-${string}`;

const OVERLAY_ID_RE = /^overlay-[a-f0-9]{12}$/;

export function isMapVectorOverlayId(value: unknown): value is MapVectorOverlayId {
  return typeof value === 'string' && OVERLAY_ID_RE.test(value);
}

export type MapOverlayPosition = [number, number] | [number, number, number];

export type MapOverlayGeometry =
  | { type: 'Point'; coordinates: MapOverlayPosition | number[] }
  | { type: 'MultiPoint'; coordinates: (MapOverlayPosition | number[])[] }
  | { type: 'LineString'; coordinates: (MapOverlayPosition | number[])[] }
  | { type: 'MultiLineString'; coordinates: (MapOverlayPosition | number[])[][] }
  | { type: 'Polygon'; coordinates: (MapOverlayPosition | number[])[][] }
  | { type: 'MultiPolygon'; coordinates: (MapOverlayPosition | number[])[][][] }
  | { type: 'GeometryCollection'; geometries: MapOverlayGeometry[] };

export interface MapOverlayFeature {
  type: 'Feature';
  properties: Record<string, unknown> | null;
  geometry: MapOverlayGeometry | null;
}

export interface MapOverlayFeatureCollection {
  type: 'FeatureCollection';
  features: MapOverlayFeature[];
}

export type OverlayFeatureCollection = MapOverlayFeatureCollection;

export interface MapVectorOverlayLayer {
  id: MapVectorOverlayId;
  name: string;
  visible: boolean;
  opacity: number;
  geojson: MapOverlayFeatureCollection;
  sourceName: string;
  addedAt: number;
}

export type MapOverlayFormat = 'geojson' | 'kml' | 'kmz';

export type MapOverlayErrorCode =
  | 'cancelled'
  | 'too_large'
  | 'limit'
  | 'empty'
  | 'malformed'
  | 'unsafe_xml'
  | 'unsafe_zip'
  | 'unsupported'
  | 'io'
  | 'not_found';

/** Parsed overlay returned by main; renderer assigns id / visibility / opacity in its store. */
export type MapOverlayImportResult =
  | {
      ok: true;
      name: string;
      format: MapOverlayFormat;
      geojson: MapOverlayFeatureCollection;
    }
  | { ok: false; code: MapOverlayErrorCode };

export const MAP_OVERLAY_MAX_BYTES = 50 * 1024 * 1024;
export const MAP_OVERLAY_MAX_LAYERS = 16;
export const MAP_OVERLAY_NAME_MAX = 80;
export const MAP_OVERLAY_KMZ_MAX_ENTRIES = 256;
export const MAP_OVERLAY_KMZ_MAX_UNCOMPRESSED_BYTES = MAP_OVERLAY_MAX_BYTES;

export function clampOverlayOpacity(value: unknown, fallback = 0.85): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function sanitizeOverlayName(value: unknown, fallback = 'Overlay'): string {
  if (typeof value !== 'string') return fallback;
  let cleaned = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code !== 127) cleaned += ch;
  }
  const trimmed = cleaned.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, MAP_OVERLAY_NAME_MAX);
}
