/** Pure terrain / Fresnel math shared by main elevation service and renderer UI. */

const C_M_S = 299_792_458;
const EARTH_RADIUS_KM = 6371;
/** ITU-R radio refraction k-factor (4/3 earth) for effective-radius bulge. */
const K_FACTOR = 4 / 3;
const EARTH_RADIUS_M = EARTH_RADIUS_KM * 1000;
const EFFECTIVE_EARTH_RADIUS_M = K_FACTOR * EARTH_RADIUS_M;

export type TerrainFrequencyMhz = 433 | 868 | 915;

export interface TerrainSamplePoint {
  lat: number;
  lon: number;
  distanceM: number;
}

export interface TerrainClearanceSample {
  distanceM: number;
  elevationM: number | null;
  /** Elevation plus earth-curvature bulge (meters); used for charting vs LOS. */
  effectiveElevationM: number | null;
  losHeightM: number | null;
  fresnelRadiusM: number | null;
  clearanceM: number | null;
}

export type TerrainClearanceStatus = 'clear' | 'obstructed' | 'unknown';

export interface TerrainClearanceSummary {
  clearance: TerrainClearanceStatus;
  minClearanceM: number | null;
  samples: TerrainClearanceSample[];
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function wavelengthM(frequencyMhz: TerrainFrequencyMhz): number {
  return C_M_S / (frequencyMhz * 1e6);
}

export function fresnelRadiusM(frequencyMhz: TerrainFrequencyMhz, d1M: number, dM: number): number {
  if (!(dM > 0) || !(d1M >= 0) || d1M > dM) return 0;
  const d2M = dM - d1M;
  if (d2M <= 0 || d1M <= 0) return 0;
  const lambda = wavelengthM(frequencyMhz);
  return 0.5 * Math.sqrt((lambda * d1M * d2M) / dM);
}

/**
 * Earth-curvature bulge (meters) at distance d1M along a path of length dM,
 * using 4/3 effective earth radius.
 */
export function earthBulgeM(d1M: number, dM: number): number {
  if (!(dM > 0) || !(d1M > 0) || d1M >= dM) return 0;
  const d2M = dM - d1M;
  return (d1M * d2M) / (2 * EFFECTIVE_EARTH_RADIUS_M);
}

export function interpolateLatLon(
  start: readonly [number, number],
  end: readonly [number, number],
  t: number,
): [number, number] {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

export function sampleGreatCirclePoints(
  start: readonly [number, number],
  end: readonly [number, number],
  count: number,
): TerrainSamplePoint[] {
  if (count < 2) return [];
  if (
    !Number.isFinite(start[0]) ||
    !Number.isFinite(start[1]) ||
    !Number.isFinite(end[0]) ||
    !Number.isFinite(end[1])
  ) {
    return [];
  }
  const totalKm = haversineKm(start[0], start[1], end[0], end[1]);
  if (!Number.isFinite(totalKm)) return [];
  const totalM = totalKm * 1000;
  const out: TerrainSamplePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const [lat, lon] = interpolateLatLon(start, end, t);
    out.push({ lat, lon, distanceM: totalM * t });
  }
  return out;
}

export function losHeightM(
  d1M: number,
  dM: number,
  startElevM: number,
  endElevM: number,
  antennaStartM: number,
  antennaEndM: number,
): number {
  if (!(dM > 0)) return startElevM + antennaStartM;
  const t = Math.min(1, Math.max(0, d1M / dM));
  const startAnt = startElevM + antennaStartM;
  const endAnt = endElevM + antennaEndM;
  return startAnt + (endAnt - startAnt) * t;
}

export function computeTerrainClearance(opts: {
  distancesM: readonly number[];
  elevationsM: readonly (number | null)[];
  frequencyMhz: TerrainFrequencyMhz;
  antennaHeightStartM: number;
  antennaHeightEndM: number;
}): TerrainClearanceSummary {
  const { distancesM, elevationsM, frequencyMhz, antennaHeightStartM, antennaHeightEndM } = opts;
  const n = Math.min(distancesM.length, elevationsM.length);
  if (n < 2) {
    return { clearance: 'unknown', minClearanceM: null, samples: [] };
  }
  const dM = distancesM[n - 1] ?? 0;
  const startElev = elevationsM[0];
  const endElev = elevationsM[n - 1];
  if (startElev == null || endElev == null || !(dM > 0)) {
    const samples: TerrainClearanceSample[] = [];
    for (let i = 0; i < n; i++) {
      const elevationM = elevationsM[i] ?? null;
      const distanceM = distancesM[i] ?? 0;
      const bulge = elevationM != null ? earthBulgeM(distanceM, dM) : 0;
      samples.push({
        distanceM,
        elevationM,
        effectiveElevationM: elevationM != null ? elevationM + bulge : null,
        losHeightM: null,
        fresnelRadiusM: null,
        clearanceM: null,
      });
    }
    return { clearance: 'unknown', minClearanceM: null, samples };
  }

  let minClearance: number | null = null;
  let anyObstructed = false;
  let anyMissingElevation = false;
  const samples: TerrainClearanceSample[] = [];

  for (let i = 0; i < n; i++) {
    const distanceM = distancesM[i] ?? 0;
    const elevationM = elevationsM[i] ?? null;
    const fresnel = fresnelRadiusM(frequencyMhz, distanceM, dM);
    const los = losHeightM(
      distanceM,
      dM,
      startElev,
      endElev,
      antennaHeightStartM,
      antennaHeightEndM,
    );
    const bulge = earthBulgeM(distanceM, dM);
    let clearanceM: number | null = null;
    if (elevationM != null) {
      clearanceM = los - elevationM - fresnel - bulge;
      if (clearanceM < 0) anyObstructed = true;
      if (minClearance == null || clearanceM < minClearance) minClearance = clearanceM;
    } else {
      anyMissingElevation = true;
    }
    samples.push({
      distanceM,
      elevationM,
      effectiveElevationM: elevationM != null ? elevationM + bulge : null,
      losHeightM: los,
      fresnelRadiusM: fresnel,
      clearanceM,
    });
  }

  // Obstructed wins; otherwise unknown if any sample lacks elevation; clear only when complete.
  const clearance: TerrainClearanceStatus = anyObstructed
    ? 'obstructed'
    : anyMissingElevation
      ? 'unknown'
      : 'clear';
  return { clearance, minClearanceM: minClearance, samples };
}
