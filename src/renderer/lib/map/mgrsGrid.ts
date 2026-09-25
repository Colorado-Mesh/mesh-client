import { forward as mgrsForward, inverse as mgrsInverse } from 'mgrs';

export interface MgrsGridSquare {
  label: string;
  /** Leaflet-style `[[south, west], [north, east]]`. */
  bounds: [[number, number], [number, number]];
}

export const MGRS_GRID_MAX_SQUARES = 400;
export const MGRS_MIN_PRECISION = 0;
export const MGRS_MAX_PRECISION = 5;

/** MGRS (UTM bands C–X) is undefined in the UPS polar caps. */
const MGRS_MIN_LAT = -80;
const MGRS_MAX_LAT = 83.999999;
const METERS_PER_DEG_LAT = 111_320;
const UTM_ZONE_WIDTH_DEG = 6;
const ZONE_EDGE_NUDGE_DEG = 1e-7;
/** Sample twice per square so no square is skipped between samples. */
const SAMPLES_PER_SQUARE = 2;

interface NormalizedBbox {
  south: number;
  north: number;
  west: number;
  /** May exceed 180 when the bbox crosses the antimeridian. */
  east: number;
}

function clampPrecision(precision: number): number {
  if (!Number.isFinite(precision)) return MGRS_MIN_PRECISION;
  return Math.min(MGRS_MAX_PRECISION, Math.max(MGRS_MIN_PRECISION, Math.round(precision)));
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

function normalizeBbox(
  south: number,
  west: number,
  north: number,
  east: number,
): NormalizedBbox | null {
  if (![south, west, north, east].every(Number.isFinite)) return null;
  const s = Math.max(Math.min(south, north), MGRS_MIN_LAT);
  const n = Math.min(Math.max(south, north), MGRS_MAX_LAT);
  if (s >= n) return null;
  let w = west;
  let e = east;
  if (e - w >= 360) {
    w = -180;
    e = 180;
  } else {
    w = wrapLon(w);
    e = wrapLon(e);
    if (e <= w) e += 360;
  }
  return { south: s, north: n, west: w, east: e };
}

export function mgrsSquareSizeMeters(precision: number): number {
  return 10 ** (MGRS_MAX_PRECISION - clampPrecision(precision));
}

function metersPerDegLon(lat: number): number {
  return METERS_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
}

function estimateFor(bbox: NormalizedBbox, precision: number): number {
  const size = mgrsSquareSizeMeters(precision);
  const midLat = (bbox.south + bbox.north) / 2;
  const rows = Math.ceil(((bbox.north - bbox.south) * METERS_PER_DEG_LAT) / size) + 1;
  const cols = Math.ceil(((bbox.east - bbox.west) * metersPerDegLon(midLat)) / size) + 1;
  return rows * cols;
}

/** Approximate square count for a viewport; `Infinity` when the bbox is unusable. */
export function estimateMgrsSquareCount(
  south: number,
  west: number,
  north: number,
  east: number,
  precision: number,
): number {
  const bbox = normalizeBbox(south, west, north, east);
  return bbox ? estimateFor(bbox, precision) : Infinity;
}

/** Finest precision whose estimated square count fits under `maxSquares`, or null. */
export function pickMgrsPrecisionForBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  maxSquares = MGRS_GRID_MAX_SQUARES,
): number | null {
  const bbox = normalizeBbox(south, west, north, east);
  if (!bbox) return null;
  for (let p = MGRS_MAX_PRECISION; p >= MGRS_MIN_PRECISION; p--) {
    if (estimateFor(bbox, p) <= maxSquares) return p;
  }
  return null;
}

function sampleAxis(start: number, end: number, step: number, extra: number[] = []): number[] {
  const values: number[] = [];
  for (let v = start; v < end; v += step) values.push(v);
  values.push(end);
  for (const v of extra) if (v > start && v < end) values.push(v);
  return values.sort((a, b) => a - b);
}

function zoneEdgeSamples(west: number, east: number): number[] {
  const edges: number[] = [];
  const first = Math.ceil((west + 180) / UTM_ZONE_WIDTH_DEG) * UTM_ZONE_WIDTH_DEG - 180;
  for (let lon = first; lon <= east; lon += UTM_ZONE_WIDTH_DEG) {
    edges.push(lon - ZONE_EDGE_NUDGE_DEG, lon + ZONE_EDGE_NUDGE_DEG);
  }
  return edges;
}

/**
 * MGRS squares covering a viewport at `precision` digits (0 = 100 km … 5 = 1 m).
 * Returns [] when the estimated count exceeds `maxSquares`, so callers can pick a coarser
 * precision instead of drawing a partial grid. Polar (UPS) regions are clipped out.
 */
export function mgrsSquaresInBbox(
  south: number,
  west: number,
  north: number,
  east: number,
  precision: number,
  maxSquares = MGRS_GRID_MAX_SQUARES,
): MgrsGridSquare[] {
  const bbox = normalizeBbox(south, west, north, east);
  if (!bbox || maxSquares <= 0) return [];
  const p = clampPrecision(precision);
  if (estimateFor(bbox, p) > maxSquares) return [];

  const size = mgrsSquareSizeMeters(p);
  const equatorCrossed = bbox.south <= 0 && bbox.north >= 0;
  const nearestEquatorLat = equatorCrossed
    ? 0
    : Math.min(Math.abs(bbox.south), Math.abs(bbox.north));
  const latStep = size / METERS_PER_DEG_LAT / SAMPLES_PER_SQUARE;
  const lonStep = size / metersPerDegLon(nearestEquatorLat) / SAMPLES_PER_SQUARE;
  const lats = sampleAxis(bbox.south, bbox.north, latStep);
  const lons = sampleAxis(bbox.west, bbox.east, lonStep, zoneEdgeSamples(bbox.west, bbox.east));

  const squares = new Map<string, MgrsGridSquare>();
  for (const lat of lats) {
    for (const rawLon of lons) {
      let label: string;
      try {
        label = mgrsForward([wrapLon(rawLon), lat], p);
      } catch {
        // catch-no-log-ok: out-of-range samples (UPS/edge rounding) have no square to draw.
        continue;
      }
      if (squares.has(label)) continue;
      let box: [number, number, number, number];
      try {
        box = mgrsInverse(label);
      } catch {
        // catch-no-log-ok: labels from forward() should invert; skip rather than fail the grid.
        continue;
      }
      const [left, bottom, right, top] = box;
      squares.set(label, {
        label,
        bounds: [
          [bottom, left],
          [top, right],
        ],
      });
      if (squares.size >= maxSquares) return [...squares.values()];
    }
  }
  return [...squares.values()];
}
