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
  return clampGridStep(step);
}

function roundCoord(value: number, step: number): number {
  const digits = step < 1 ? 2 : 1;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Generate rounded grid coordinates; handles antimeridian wrap. */
export function buildGridCells(spec: GridSpec): GridCell[] {
  const step = clampGridStep(spec.stepDeg);
  const maxPoints = Math.max(1, Math.min(WEATHER_GRID_MAX_POINTS, spec.maxPoints));
  const south = clampLat(Math.max(-85, spec.bounds.south));
  const north = clampLat(Math.min(85, spec.bounds.north));
  const cells: GridCell[] = [];
  const seen = new Set<string>();

  for (let lat = south; lat <= north + 1e-9; lat += step) {
    const latR = roundCoord(clampLat(lat), step);
    if (spec.bounds.east >= spec.bounds.west) {
      for (let lon = spec.bounds.west; lon <= spec.bounds.east + 1e-9; lon += step) {
        const lonR = roundCoord(normalizeLon(lon), step);
        const key = `${latR},${lonR}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ lat: latR, lon: lonR });
        if (cells.length >= maxPoints) return cells;
      }
    } else {
      for (let lon = spec.bounds.west; lon <= 180 + 1e-9; lon += step) {
        const lonR = roundCoord(normalizeLon(lon), step);
        const key = `${latR},${lonR}`;
        if (!seen.has(key)) {
          seen.add(key);
          cells.push({ lat: latR, lon: lonR });
          if (cells.length >= maxPoints) return cells;
        }
      }
      for (let lon = -180; lon <= spec.bounds.east + 1e-9; lon += step) {
        const lonR = roundCoord(normalizeLon(lon), step);
        const key = `${latR},${lonR}`;
        if (!seen.has(key)) {
          seen.add(key);
          cells.push({ lat: latR, lon: lonR });
          if (cells.length >= maxPoints) return cells;
        }
      }
    }
  }
  return cells;
}

/** Stable cache key for a point: two decimals (~1.1 km). */
export function weatherPointCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}
