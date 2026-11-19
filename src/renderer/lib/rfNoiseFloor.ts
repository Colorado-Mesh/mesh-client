import type { MeshNode } from './types';

/**
 * RF-panel noise-floor helpers. A receiver noise floor is only meaningful inside the LoRa band
 * (-140…-20 dBm); values outside it (notably protobuf default 0) mean "not reported" and must
 * never be charted or recorded as real readings.
 */

/** Same "elevated interference" threshold the MeshCore diagnostics finding uses. */
export const NOISE_FLOOR_ELEVATED_DBM = -95;
export const NOISE_FLOOR_MIN_PLAUSIBLE_DBM = -140;
export const NOISE_FLOOR_MAX_PLAUSIBLE_DBM = -20;
/** Fewer RSSI/SNR pairs than this is too noisy to advertise as an estimate. */
export const NOISE_FLOOR_MIN_ESTIMATE_SAMPLES = 3;

export interface LocalNoiseFloorReading {
  /** dBm */
  value: number;
  /**
   * Stable observation identity from the source report (Meshtastic telemetry timestamp or
   * MeshCore radio stats `fetchedAt`). Remounts of the same report reuse this value.
   */
  observedAt?: number;
}

export interface NoiseFloorBucket {
  label: string;
  test: (v: number) => boolean;
}

/** 10 dBm bins; the elevated threshold (-95) sits inside one bin label on purpose. */
export const ESTIMATED_NOISE_FLOOR_BUCKETS: NoiseFloorBucket[] = [
  { label: '<-125', test: (v) => v < -125 },
  { label: '-125–-115', test: (v) => v >= -125 && v < -115 },
  { label: '-115–-105', test: (v) => v >= -115 && v < -105 },
  { label: '-105–-95', test: (v) => v >= -105 && v < -95 },
  { label: '-95–-85', test: (v) => v >= -95 && v < -85 },
  { label: '≥-85', test: (v) => v >= -85 },
];

export function isPlausibleNoiseFloorDbm(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= NOISE_FLOOR_MIN_PLAUSIBLE_DBM &&
    value <= NOISE_FLOOR_MAX_PLAUSIBLE_DBM
  );
}

export function isElevatedNoiseFloor(value: number): boolean {
  return value > NOISE_FLOOR_ELEVATED_DBM;
}

/**
 * Live reading for the connected radio. Meshtastic keeps it on `MeshNode.noise_floor`; MeshCore
 * keeps it inside `meshcore_local_stats` — both are read here so the panel stays protocol-neutral
 * (no `protocol === 'meshcore'` branches; see AGENTS.md §1).
 */
export function readLocalNoiseFloor(node: MeshNode | undefined): LocalNoiseFloorReading | null {
  if (!node) return null;
  if (isPlausibleNoiseFloorDbm(node.noise_floor)) {
    return {
      value: node.noise_floor,
      ...(node.noise_floor_observed_at != null ? { observedAt: node.noise_floor_observed_at } : {}),
    };
  }
  const stats = node.meshcore_local_stats;
  if (stats && isPlausibleNoiseFloorDbm(stats.noiseFloor)) {
    return { value: stats.noiseFloor, observedAt: stats.fetchedAt };
  }
  return null;
}

/**
 * LoRa receiver-noise estimate from one packet: N = RSSI − SNR (both dB).
 * Returns null when either value is missing/zero (both protocols use 0 as "not measured").
 */
export function estimateNoiseFloorDbm(rssi: unknown, snr: unknown): number | null {
  if (typeof rssi !== 'number' || typeof snr !== 'number') return null;
  if (!Number.isFinite(rssi) || !Number.isFinite(snr)) return null;
  if (rssi === 0 || snr === 0) return null;
  const estimate = rssi - snr;
  return isPlausibleNoiseFloorDbm(estimate) ? estimate : null;
}

/** Per-node estimates (one per node, from its last heard packet). */
export function collectEstimatedNoiseFloors(nodes: Iterable<MeshNode>): number[] {
  const out: number[] = [];
  for (const node of nodes) {
    const estimate = estimateNoiseFloorDbm(node.rssi, node.snr);
    if (estimate != null) out.push(estimate);
  }
  return out;
}

/** Median (order statistic, no allocation surprises for the ≤ a few hundred node case). */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
