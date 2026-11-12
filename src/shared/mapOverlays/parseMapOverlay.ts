/**
 * Safe-subset parsers for local GeoJSON and KML → FeatureCollection.
 * Rejects XXE-ish XML constructs and does not fetch network hrefs.
 */

import {
  MAP_OVERLAY_MAX_BYTES,
  type MapOverlayFeature,
  type MapOverlayFeatureCollection,
  type MapOverlayFormat,
  type MapOverlayGeometry,
  type MapOverlayPosition,
  sanitizeOverlayName,
} from './types';

export class MapOverlayParseError extends Error {
  readonly code: 'too_large' | 'empty' | 'malformed' | 'unsafe_xml' | 'unsupported';

  constructor(code: MapOverlayParseError['code'], message?: string) {
    super(message ?? code);
    this.name = 'MapOverlayParseError';
    this.code = code;
  }
}

const UNSAFE_XML_RE = /<!DOCTYPE\b|<!ENTITY\b|\bSYSTEM\s+["']|\bPUBLIC\s+["']/i;

export function assertOverlayByteBudget(text: string, maxBytes = MAP_OVERLAY_MAX_BYTES): void {
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    throw new MapOverlayParseError('too_large', `Overlay exceeds ${maxBytes} bytes`);
  }
}

/** Reject DTD / entity constructs that enable XXE-style expansion. */
export function assertSafeKmlXml(text: string): void {
  if (UNSAFE_XML_RE.test(text)) {
    throw new MapOverlayParseError('unsafe_xml', 'DOCTYPE or ENTITY declarations are not allowed');
  }
}

export function mapOverlayFormatFromName(fileName: string): MapOverlayFormat | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.geojson') || lower.endsWith('.json')) return 'geojson';
  if (lower.endsWith('.kml')) return 'kml';
  if (lower.endsWith('.kmz')) return 'kmz';
  return null;
}

export function mapOverlayDisplayName(fileName: string): string {
  const base = fileName.replace(/\.(geojson|json|kml|kmz)$/i, '');
  return sanitizeOverlayName(base || fileName);
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function asPosition(raw: unknown): MapOverlayPosition | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lon: unknown = raw[0];
  const lat: unknown = raw[1];
  if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  const alt: unknown = raw[2];
  if (raw.length >= 3 && isFiniteNumber(alt)) return [lon, lat, alt];
  return [lon, lat];
}

function asPositionRing(raw: unknown): MapOverlayPosition[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: MapOverlayPosition[] = [];
  for (const p of raw) {
    const pos = asPosition(p);
    if (!pos) return null;
    out.push(pos);
  }
  return out;
}

function sanitizeGeometry(raw: unknown): MapOverlayGeometry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const g = raw as Record<string, unknown>;
  const type = g.type;
  if (typeof type !== 'string') return null;
  switch (type) {
    case 'Point': {
      const coordinates = asPosition(g.coordinates);
      return coordinates ? { type, coordinates } : null;
    }
    case 'MultiPoint':
    case 'LineString': {
      const coordinates = asPositionRing(g.coordinates);
      return coordinates ? { type, coordinates } : null;
    }
    case 'MultiLineString':
    case 'Polygon': {
      if (!Array.isArray(g.coordinates)) return null;
      const coordinates: MapOverlayPosition[][] = [];
      for (const ring of g.coordinates) {
        const parsed = asPositionRing(ring);
        if (!parsed) return null;
        coordinates.push(parsed);
      }
      return { type, coordinates };
    }
    case 'MultiPolygon': {
      if (!Array.isArray(g.coordinates)) return null;
      const coordinates: MapOverlayPosition[][][] = [];
      for (const poly of g.coordinates) {
        if (!Array.isArray(poly)) return null;
        const rings: MapOverlayPosition[][] = [];
        for (const ring of poly) {
          const parsed = asPositionRing(ring);
          if (!parsed) return null;
          rings.push(parsed);
        }
        coordinates.push(rings);
      }
      return { type, coordinates };
    }
    case 'GeometryCollection': {
      if (!Array.isArray(g.geometries)) return null;
      const geometries: MapOverlayGeometry[] = [];
      for (const child of g.geometries) {
        const parsed = sanitizeGeometry(child);
        if (!parsed) return null;
        geometries.push(parsed);
      }
      return { type, geometries };
    }
    default:
      return null;
  }
}

function featureFromGeometry(
  geometry: MapOverlayGeometry,
  properties: Record<string, unknown> | null,
): MapOverlayFeature {
  return { type: 'Feature', properties, geometry };
}

function sanitizeFeature(raw: unknown): MapOverlayFeature | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (f.type !== 'Feature') return null;
  const geometry = f.geometry == null ? null : sanitizeGeometry(f.geometry);
  if (f.geometry != null && geometry == null) return null;
  const properties =
    f.properties == null
      ? null
      : typeof f.properties === 'object' && !Array.isArray(f.properties)
        ? (f.properties as Record<string, unknown>)
        : null;
  return { type: 'Feature', properties, geometry };
}

export function parseGeoJsonToFeatureCollection(text: string): MapOverlayFeatureCollection {
  assertOverlayByteBudget(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new MapOverlayParseError('malformed', 'Invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new MapOverlayParseError('malformed', 'GeoJSON root must be an object');
  }
  const root = parsed as Record<string, unknown>;
  if (root.type === 'FeatureCollection') {
    if (!Array.isArray(root.features)) {
      throw new MapOverlayParseError('malformed', 'FeatureCollection.features must be an array');
    }
    const features: MapOverlayFeature[] = [];
    for (const item of root.features) {
      const feature = sanitizeFeature(item);
      if (!feature) throw new MapOverlayParseError('malformed', 'Invalid Feature in collection');
      features.push(feature);
    }
    if (features.length === 0) throw new MapOverlayParseError('empty');
    return { type: 'FeatureCollection', features };
  }
  if (root.type === 'Feature') {
    const feature = sanitizeFeature(root);
    if (!feature) throw new MapOverlayParseError('malformed', 'Invalid Feature');
    return { type: 'FeatureCollection', features: [feature] };
  }
  const geometry = sanitizeGeometry(root);
  if (!geometry) throw new MapOverlayParseError('malformed', 'Unsupported GeoJSON type');
  return { type: 'FeatureCollection', features: [featureFromGeometry(geometry, null)] };
}

function decodeXmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function firstNameTagText(body: string): string | null {
  const m = /<name\b[^>]*>([\s\S]*?)<\/name>/i.exec(body);
  if (!m?.[1]) return null;
  return decodeXmlText(m[1].replace(/<[^>]+>/g, ' '));
}

function parseCoordinateTuples(text: string): MapOverlayPosition[] {
  const out: MapOverlayPosition[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(',');
    if (parts.length < 2) {
      throw new MapOverlayParseError('malformed', 'Invalid KML coordinates');
    }
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new MapOverlayParseError('malformed', 'Non-numeric KML coordinates');
    }
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new MapOverlayParseError('malformed', 'KML coordinates out of range');
    }
    if (parts.length >= 3 && Number.isFinite(Number(parts[2]))) {
      out.push([lon, lat, Number(parts[2])]);
    } else {
      out.push([lon, lat]);
    }
  }
  if (out.length === 0) throw new MapOverlayParseError('malformed', 'Empty KML coordinates');
  return out;
}

function coordinatesFromBlock(block: string): MapOverlayPosition[] {
  const m = /<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i.exec(block);
  if (!m?.[1]) throw new MapOverlayParseError('malformed', 'Missing KML coordinates');
  return parseCoordinateTuples(decodeXmlText(m[1]));
}

function requireIndexed<T>(items: readonly T[], index: number, message: string): T {
  const value = items[index];
  if (value === undefined) throw new MapOverlayParseError('malformed', message);
  return value;
}

function parseKmlGeometry(block: string): MapOverlayGeometry | null {
  const point = /<Point\b[^>]*>([\s\S]*?)<\/Point>/i.exec(block);
  if (point?.[1]) {
    return {
      type: 'Point',
      coordinates: requireIndexed(coordinatesFromBlock(point[1]), 0, 'Empty Point coordinates'),
    };
  }

  const line = /<LineString\b[^>]*>([\s\S]*?)<\/LineString>/i.exec(block);
  if (line?.[1]) {
    return { type: 'LineString', coordinates: coordinatesFromBlock(line[1]) };
  }

  const polygon = /<Polygon\b[^>]*>([\s\S]*?)<\/Polygon>/i.exec(block);
  if (polygon?.[1]) {
    const outer =
      /<outerBoundaryIs\b[^>]*>[\s\S]*?<LinearRing\b[^>]*>([\s\S]*?)<\/LinearRing>[\s\S]*?<\/outerBoundaryIs>/i.exec(
        polygon[1],
      ) ?? /<LinearRing\b[^>]*>([\s\S]*?)<\/LinearRing>/i.exec(polygon[1]);
    if (!outer?.[1]) return null;
    const rings: MapOverlayPosition[][] = [coordinatesFromBlock(outer[1])];
    const innerRe =
      /<innerBoundaryIs\b[^>]*>[\s\S]*?<LinearRing\b[^>]*>([\s\S]*?)<\/LinearRing>[\s\S]*?<\/innerBoundaryIs>/gi;
    let inner: RegExpExecArray | null;
    while ((inner = innerRe.exec(polygon[1])) !== null) {
      const ringBody = inner[1];
      if (typeof ringBody === 'string') rings.push(coordinatesFromBlock(ringBody));
    }
    return { type: 'Polygon', coordinates: rings };
  }

  const multi = /<MultiGeometry\b[^>]*>([\s\S]*?)<\/MultiGeometry>/i.exec(block);
  if (multi?.[1]) {
    const geometries: MapOverlayGeometry[] = [];
    const childRe = /<(Point|LineString|Polygon|MultiGeometry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let child: RegExpExecArray | null;
    while ((child = childRe.exec(multi[1])) !== null) {
      const parsed = parseKmlGeometry(child[0]);
      if (parsed) geometries.push(parsed);
    }
    if (geometries.length === 0) return null;
    if (geometries.length === 1) {
      return requireIndexed(geometries, 0, 'Empty MultiGeometry');
    }
    return { type: 'GeometryCollection', geometries };
  }

  return null;
}

function assertNoNetworkKml(text: string): void {
  if (/<NetworkLink\b/i.test(text)) {
    throw new MapOverlayParseError('unsupported', 'NetworkLink is not supported');
  }
  // Reject remote hrefs (icons, NetworkLink leftovers, etc.) — v1 never fetches http(s).
  if (/<href\b[^>]*>[\s\S]*?https?:\/\//i.test(text)) {
    throw new MapOverlayParseError('unsupported', 'network href is not supported');
  }
}

/**
 * Parse a safe KML subset: Document/Folder/Placemark with Point, LineString, Polygon, MultiGeometry.
 * NetworkLink / remote href / GroundOverlay are rejected or ignored per v1 non-goals.
 */
export function parseKmlToGeoJson(text: string): MapOverlayFeatureCollection {
  assertOverlayByteBudget(text);
  assertSafeKmlXml(text);
  assertNoNetworkKml(text);
  const features: MapOverlayFeature[] = [];
  const placemarkRe = /<Placemark\b[^>]*>[\s\S]*?<\/Placemark>/gi;
  let match: RegExpExecArray | null;
  while ((match = placemarkRe.exec(text)) !== null) {
    const full = match[0];
    const openEnd = full.indexOf('>');
    const closeStart = full.lastIndexOf('</');
    if (openEnd < 0 || closeStart <= openEnd) continue;
    const body = full.slice(openEnd + 1, closeStart);
    const geometry = parseKmlGeometry(body);
    if (!geometry) continue;
    const name = firstNameTagText(body);
    features.push(
      featureFromGeometry(geometry, name ? { name: sanitizeOverlayName(name, name) } : null),
    );
  }
  if (features.length === 0) {
    throw new MapOverlayParseError('empty', 'No drawable Placemarks found');
  }
  return { type: 'FeatureCollection', features };
}

export function kmlDocumentName(text: string, fallback: string): string {
  try {
    assertSafeKmlXml(text);
  } catch {
    return sanitizeOverlayName(fallback);
  }
  const docName = firstNameTagText(text);
  return sanitizeOverlayName(docName ?? fallback, fallback);
}

export function parseMapOverlayText(
  text: string,
  format: 'geojson' | 'kml',
): MapOverlayFeatureCollection {
  if (format === 'geojson') return parseGeoJsonToFeatureCollection(text);
  return parseKmlToGeoJson(text);
}
