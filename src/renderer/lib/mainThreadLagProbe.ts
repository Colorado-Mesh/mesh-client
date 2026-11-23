/**
 * Opt-in main-thread lag probe (same flag as {@link PERF_TRACE_ENABLED}).
 * Measures event-loop delay vs a 100 ms tick — the objective "freeze" metric.
 */

import { PERF_TRACE_ENABLED } from './perfTrace';

const TICK_MS = 100;
const MAX_SAMPLES = 512;

interface LagSample {
  lagMs: number;
  visibilityState: DocumentVisibilityState | 'unknown';
}

let samples: LagSample[] = [];
let maxLagMs = 0;
let timer: ReturnType<typeof setInterval> | undefined;
let lastTick = 0;
let started = false;

function visibility(): DocumentVisibilityState | 'unknown' {
  try {
    return document.visibilityState;
  } catch (e: unknown) {
    console.debug('[renderer/lib/mainThreadLagProbe] catch:', e);

    return 'unknown';
  }
}

function recordTick(): void {
  const now = performance.now();
  if (lastTick > 0) {
    const lagMs = Math.max(0, now - (lastTick + TICK_MS));
    samples.push({ lagMs, visibilityState: visibility() });
    if (samples.length > MAX_SAMPLES) samples = samples.slice(samples.length - MAX_SAMPLES);
    if (lagMs > maxLagMs) maxLagMs = lagMs;
  }
  lastTick = now;
}

/** Start the 100 ms lag probe when perf tracing is enabled. Idempotent. */
export function startMainThreadLagProbe(): void {
  if (!PERF_TRACE_ENABLED || started) return;
  started = true;
  lastTick = performance.now();
  timer = setInterval(recordTick, TICK_MS);
}

/** Stop the probe (tests / teardown). */
export function stopMainThreadLagProbe(): void {
  if (timer != null) clearInterval(timer);
  timer = undefined;
  started = false;
  lastTick = 0;
}

/** Clear accumulated samples without stopping the probe. */
export function resetMainThreadLagProbe(): void {
  samples = [];
  maxLagMs = 0;
  lastTick = performance.now();
}

export interface MainThreadLagSnapshot {
  sampleCount: number;
  maxMs: number;
  p95Ms: number;
  visibilityState: DocumentVisibilityState | 'unknown';
}

/** Snapshot for `__meshPerf()` / benches. */
export function mainThreadLagSnapshot(): MainThreadLagSnapshot {
  if (samples.length === 0) {
    return { sampleCount: 0, maxMs: 0, p95Ms: 0, visibilityState: visibility() };
  }
  const lags = samples.map((s) => s.lagMs).sort((a, b) => a - b);
  const p95Index = Math.min(lags.length - 1, Math.floor(lags.length * 0.95));
  return {
    sampleCount: samples.length,
    maxMs: Number(maxLagMs.toFixed(3)),
    p95Ms: Number(lags[p95Index].toFixed(3)),
    visibilityState: visibility(),
  };
}
