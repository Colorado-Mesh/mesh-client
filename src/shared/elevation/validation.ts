import type {
  ElevationFrequencyMhz,
  ElevationHgtEstimateRequest,
  ElevationProfileRequest,
} from './types';

const MAX_SAMPLE_COUNT = 128;
const MIN_SAMPLE_COUNT = 8;
const DEFAULT_SAMPLE_COUNT = 64;
const MAX_ANTENNA_M = 500;
const MAX_PATH_KM = 500;

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isLatLon(v: { lat?: unknown; lon?: unknown } | null | undefined): boolean {
  if (v == null) return false;
  return (
    isFiniteNumber(v.lat) &&
    isFiniteNumber(v.lon) &&
    v.lat >= -90 &&
    v.lat <= 90 &&
    v.lon >= -180 &&
    v.lon <= 180
  );
}

export function parseFrequencyMhz(raw: unknown): ElevationFrequencyMhz {
  if (raw === 433 || raw === 868 || raw === 915) return raw;
  return 915;
}

export function clampSampleCount(raw: unknown): number {
  if (!isFiniteNumber(raw)) return DEFAULT_SAMPLE_COUNT;
  const n = Math.round(raw);
  if (n < MIN_SAMPLE_COUNT) return MIN_SAMPLE_COUNT;
  if (n > MAX_SAMPLE_COUNT) return MAX_SAMPLE_COUNT;
  return n;
}

export function clampAntennaHeightM(raw: unknown, fallback = 2): number {
  if (!isFiniteNumber(raw)) return fallback;
  if (raw < 0) return 0;
  if (raw > MAX_ANTENNA_M) return MAX_ANTENNA_M;
  return raw;
}

export function parseElevationProfileRequest(raw: unknown): ElevationProfileRequest | null {
  if (raw == null || typeof raw !== 'object') return null;
  const v = raw as Partial<ElevationProfileRequest>;
  if (!isLatLon(v.start) || !isLatLon(v.end)) return null;
  return {
    start: { lat: v.start!.lat, lon: v.start!.lon },
    end: { lat: v.end!.lat, lon: v.end!.lon },
    antennaHeightStartM: clampAntennaHeightM(v.antennaHeightStartM),
    antennaHeightEndM: clampAntennaHeightM(v.antennaHeightEndM),
    frequencyMhz: parseFrequencyMhz(v.frequencyMhz),
    sampleCount: clampSampleCount(v.sampleCount),
  };
}

export function parseHgtEstimateRequest(raw: unknown): ElevationHgtEstimateRequest | null {
  if (raw == null || typeof raw !== 'object') return null;
  const v = raw as Partial<ElevationHgtEstimateRequest>;
  if (
    !isFiniteNumber(v.south) ||
    !isFiniteNumber(v.west) ||
    !isFiniteNumber(v.north) ||
    !isFiniteNumber(v.east)
  ) {
    return null;
  }
  if (v.south >= v.north || v.west >= v.east) return null;
  if (v.south < -90 || v.north > 90 || v.west < -180 || v.east > 180) return null;
  // Cap corridor size (~10° ≈ 1100 km) to avoid huge downloads.
  if (v.north - v.south > 10 || v.east - v.west > 10) return null;
  return { south: v.south, west: v.west, north: v.north, east: v.east };
}

export { DEFAULT_SAMPLE_COUNT, MAX_PATH_KM, MAX_SAMPLE_COUNT, MIN_SAMPLE_COUNT };
