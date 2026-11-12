import { MESHCORE_NOISE_FLOOR_TREND_POLL_MS } from '../timeConstants';

export { MESHCORE_NOISE_FLOOR_TREND_POLL_MS };

/**
 * MeshCore noise-floor trend helpers: retain recent samples, aggregate min/max/last,
 * and build SVG sparkline points (same layout as EnvironmentSparklines).
 */

export interface NoiseFloorSample {
  /** Epoch ms when the reading was observed. */
  t: number;
  /** Noise floor in dBm. Zero is a valid reading; absence of samples means no data. */
  noiseFloor: number;
}

export interface NoiseFloorAggregate {
  min: number;
  max: number;
  last: number;
  count: number;
}

/** Keep roughly one hour of live samples while a node detail panel is watched. */
export const NOISE_FLOOR_HISTORY_WINDOW_MS = 60 * 60 * 1000;

/** Cap per-node series (60s poll ≈ 60 pts/hour; leave headroom for manual refreshes). */
export const NOISE_FLOOR_HISTORY_MAX_POINTS = 120;

/** Cap distinct nodes retained in the in-memory store. */
export const NOISE_FLOOR_HISTORY_MAX_NODES = 64;

/** Drop identical consecutive readings inside this window (runtime + UI double-ingest). */
export const NOISE_FLOOR_SAMPLE_DEDUP_MS = 5_000;

export function isValidNoiseFloorReading(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Append a sample, pruning by retention window and per-node cap.
 * Returns the next series, or `null` when the sample was rejected / deduped.
 */
export function appendNoiseFloorSample(
  existing: readonly NoiseFloorSample[],
  sample: NoiseFloorSample,
  options?: {
    nowMs?: number;
    windowMs?: number;
    maxPoints?: number;
    dedupMs?: number;
  },
): readonly NoiseFloorSample[] | null {
  if (!isValidNoiseFloorReading(sample.noiseFloor) || !Number.isFinite(sample.t)) return null;
  const nowMs = options?.nowMs ?? sample.t;
  const windowMs = options?.windowMs ?? NOISE_FLOOR_HISTORY_WINDOW_MS;
  const maxPoints = options?.maxPoints ?? NOISE_FLOOR_HISTORY_MAX_POINTS;
  const dedupMs = options?.dedupMs ?? NOISE_FLOOR_SAMPLE_DEDUP_MS;

  const last = existing.at(-1);
  if (last?.noiseFloor === sample.noiseFloor) {
    if (sample.t - last.t >= 0 && sample.t - last.t < dedupMs) {
      return null;
    }
  }

  const cutoff = nowMs - windowMs;
  let start = 0;
  const len = existing.length;
  while (start < len && existing[start].t < cutoff) start++;
  const maxKeep = Math.max(0, maxPoints - 1);
  if (len - start > maxKeep) start = len - maxKeep;
  const next = existing.slice(start);
  next.push({ t: sample.t, noiseFloor: sample.noiseFloor });
  return next;
}

/** Min / max / last over samples, or null when there is no data (distinct from a 0 dBm reading). */
export function aggregateNoiseFloorSamples(
  samples: readonly NoiseFloorSample[],
): NoiseFloorAggregate | null {
  if (samples.length === 0) return null;
  let min = samples[0].noiseFloor;
  let max = samples[0].noiseFloor;
  for (let i = 1; i < samples.length; i++) {
    const v = samples[i].noiseFloor;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    min,
    max,
    last: samples[samples.length - 1].noiseFloor,
    count: samples.length,
  };
}

/**
 * SVG polyline points for noise-floor samples (viewBox 200×40), or null with fewer than two.
 * Mirrors EnvironmentSparklines sparklinePoints layout.
 */
export function noiseFloorSparklinePoints(
  samples: readonly NoiseFloorSample[],
  options?: { width?: number; height?: number; padY?: number },
): string | null {
  if (samples.length < 2) return null;
  const width = options?.width ?? 200;
  const height = options?.height ?? 40;
  const padY = options?.padY ?? 2;
  const usableY = height - padY * 2;
  let minV = samples[0].noiseFloor;
  let maxV = samples[0].noiseFloor;
  for (let i = 1; i < samples.length; i++) {
    const v = samples[i].noiseFloor;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const range = maxV - minV || 1;
  const minT = samples[0].t;
  const timeRange = samples[samples.length - 1].t - minT || 1;
  return samples
    .map((s) => {
      const x = ((s.t - minT) / timeRange) * width;
      const y = height - padY - ((s.noiseFloor - minV) / range) * usableY;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
