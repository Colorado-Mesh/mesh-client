import {
  clampGridStep,
  clampLat,
  type LatLonBounds,
  normalizeLon,
  WEATHER_GRID_MAX_POINTS,
} from './validation';

export interface GridSpec {
  bounds: LatLonBounds;
  zoom: number;
  stepDeg: number;
  maxPoints: number;
}

export interface GridCell {
  lat: number;
  lon: number;
}

const STEP_LADDER = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] as const;

function lonSpanDeg(bounds: LatLonBounds): number {
  if (bounds.east >= bounds.west) return Math.max(0.01, bounds.east - bounds.west);
  return Math.max(0.01, 360 - bounds.west + bounds.east);
}

/** Choose a step from the ladder so the point count stays <= maxPoints. */
export function chooseGridStep(bounds: LatLonBounds, zoom: number): number {
  const target = zoom >= 10 ? 0.1 : zoom >= 7 ? 0.25 : zoom >= 5 ? 1 : zoom >= 4 ? 2 : 5;
  const latSpan = Math.max(0.01, bounds.north - bounds.south);
  const lonSpan = lonSpanDeg(bounds);
  let step = target;
  for (const s of STEP_LADDER) {
    if (s < target) continue;
    step = s;
    const nLat = Math.ceil(latSpan / step) + 1;
    const nLon = Math.ceil(lonSpan / step) + 1;
    if (nLat * nLon <= WEATHER_GRID_MAX_POINTS) break;
  }
  // If still over cap at WEATHER_GRID_MAX_STEP_DEG, buildGridCells subsamples evenly.
  return clampGridStep(step);
}

function roundCoord(value: number, step: number): number {
  const digits = step < 1 ? 2 : 1;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Evenly pick `count` values from `values`, always including ends when count > 1. */
function subsampleEven(values: readonly number[], count: number): number[] {
  if (values.length === 0 || count <= 0) return [];
  if (values.length <= count) return [...values];
  if (count === 1) {
    const mid = values.at(Math.floor(values.length / 2));
    return mid == null ? [] : [mid];
  }
  const out: number[] = [];
  const last = values.length - 1;
  for (let i = 0; i < count; i++) {
    const v = values.at(Math.round((i * last) / (count - 1)));
    if (v != null) out.push(v);
  }
  return out;
}

function listLats(south: number, north: number, step: number): number[] {
  const out: number[] = [];
  for (let lat = south; lat <= north + 1e-9; lat += step) {
    out.push(roundCoord(clampLat(lat), step));
  }
  if (out.length === 0) out.push(roundCoord(clampLat((south + north) / 2), step));
  return out;
}

function listLons(bounds: LatLonBounds, step: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (lon: number) => {
    const lonR = roundCoord(normalizeLon(lon), step);
    if (seen.has(lonR)) return;
    seen.add(lonR);
    out.push(lonR);
  };
  if (bounds.east >= bounds.west) {
    for (let lon = bounds.west; lon <= bounds.east + 1e-9; lon += step) push(lon);
  } else {
    for (let lon = bounds.west; lon <= 180 + 1e-9; lon += step) push(lon);
    for (let lon = -180; lon <= bounds.east + 1e-9; lon += step) push(lon);
  }
  if (out.length === 0) push((bounds.west + bounds.east) / 2);
  return out;
}

/**
 * Generate rounded grid coordinates covering the full viewport.
 * When the dense lattice would exceed maxPoints, subsample rows/cols evenly
 * (including edges) instead of truncating south→north iteration early.
 */
export function buildGridCells(spec: GridSpec): GridCell[] {
  const step = clampGridStep(spec.stepDeg);
  const maxPoints = Math.max(1, Math.min(WEATHER_GRID_MAX_POINTS, spec.maxPoints));
  const south = clampLat(Math.max(-85, spec.bounds.south));
  const north = clampLat(Math.min(85, spec.bounds.north));

  const lats = listLats(south, north, step);
  const lons = listLons(spec.bounds, step);

  let nLat = lats.length;
  let nLon = lons.length;
  if (nLat * nLon > maxPoints) {
    const aspect = nLon / Math.max(1, nLat);
    nLat = Math.max(1, Math.floor(Math.sqrt(maxPoints / Math.max(aspect, 1e-6))));
    nLon = Math.max(1, Math.floor(maxPoints / nLat));
    while (nLat * nLon > maxPoints && nLat > 1) nLat -= 1;
    while (nLat * nLon > maxPoints && nLon > 1) nLon -= 1;
  }

  const latSamples = subsampleEven(lats, nLat);
  const lonSamples = subsampleEven(lons, nLon);
  const cells: GridCell[] = [];
  const seen = new Set<string>();
  for (const lat of latSamples) {
    for (const lon of lonSamples) {
      const key = `${lat},${lon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push({ lat, lon });
    }
  }
  return cells;
}

/** Stable cache key for a point: two decimals (~1.1 km). */
export function weatherPointCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}
