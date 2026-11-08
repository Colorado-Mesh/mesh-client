/** Shared elevation / terrain-profile IPC types. */

export type ElevationFrequencyMhz = 433 | 868 | 915;

export interface ElevationSamplePoint {
  lat: number;
  lon: number;
  /** Cumulative distance from path start in meters. */
  distanceM: number;
  /** Ground elevation meters above sea level, or null when unknown. */
  elevationM: number | null;
}

export interface ElevationProfileRequest {
  /** Path endpoints [start, end] as [lat, lon]. */
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  /** Antenna height above ground at start (meters). */
  antennaHeightStartM?: number;
  /** Antenna height above ground at end (meters). */
  antennaHeightEndM?: number;
  /** LoRa band for Fresnel radius; default 915. */
  frequencyMhz?: ElevationFrequencyMhz;
  /** Number of elevation samples along the path (inclusive of endpoints). */
  sampleCount?: number;
}

export interface ElevationProfileSample extends ElevationSamplePoint {
  /** Straight-line radio path height AGL (meters) at this distance. */
  losHeightM: number | null;
  /** First Fresnel zone radius (meters) at this distance. */
  fresnelRadiusM: number | null;
  /** losHeightM − elevationM − fresnelRadiusM; negative means obstructed. */
  clearanceM: number | null;
}

export type ElevationProfileClearance = 'clear' | 'obstructed' | 'unknown';

export interface ElevationProfileResult {
  samples: ElevationProfileSample[];
  totalDistanceM: number;
  frequencyMhz: ElevationFrequencyMhz;
  antennaHeightStartM: number;
  antennaHeightEndM: number;
  clearance: ElevationProfileClearance;
  /** Minimum clearance along the path (meters); null when unknown. */
  minClearanceM: number | null;
  /** True when at least one sample used network elevation (vs HGT cache only). */
  usedNetwork: boolean;
  /** True when every sample came from offline HGT tiles. */
  fullyOffline: boolean;
}

export type ElevationErrorCode =
  'invalid_request' | 'offline' | 'fetch_failed' | 'no_elevation' | 'cancelled';

export type ElevationResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ElevationErrorCode; message: string } };

export interface ElevationHgtEstimateRequest {
  /** Bounding box covering the corridor (degrees). */
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface ElevationHgtEstimate {
  tileNames: string[];
  missingTileNames: string[];
  /** Approx uncompressed bytes for missing tiles. */
  missingBytes: number;
}

export interface ElevationHgtDownloadRequest extends ElevationHgtEstimateRequest {
  /** Optional job id echoed in progress events. */
  jobId?: string;
}

export interface ElevationHgtProgress {
  jobId: string;
  completed: number;
  total: number;
  failed: number;
  currentTile?: string;
  done?: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface ElevationCacheStats {
  sampleEntries: number;
  hgtTiles: number;
  hgtBytes: number;
}
