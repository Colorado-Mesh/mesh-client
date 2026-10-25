/**
 * Bounded high-res timing ring for Support / debug snapshots.
 * Uses performance.now() (finer under COI); never wall-clock clocks for sample times.
 */

export const RENDERER_TIMING_MAX_SAMPLES = 64;

export type RendererTimingName =
  | 'ingest'
  | 'diagnosticsPass'
  | 'topologyBuild'
  | 'mapRender'
  | 'reactCommit'
  | 'encodeMessage'
  | 'other';

export interface RendererTimingSample {
  name: string;
  /** Elapsed ms from performance.now(). */
  durationMs: number;
  at: number;
}

export interface RendererTimingsSnapshot {
  /** Approximate timer resolution label for cross-origin comparison. */
  resolutionLabel: 'fine' | 'coarse';
  crossOriginIsolated: boolean;
  samples: readonly RendererTimingSample[];
  /** Count of samples dropped because the ring was full (overwrite is normal; this is unused). */
  enabled: boolean;
}

interface TimingEnvironment {
  now: () => number;
  isIsolated: () => boolean;
  isEnabled: () => boolean;
}

function defaultResolutionLabel(isolated: boolean): 'fine' | 'coarse' {
  return isolated ? 'fine' : 'coarse';
}

export function createRendererTimingRing(environment: TimingEnvironment) {
  let samples: RendererTimingSample[] = [];
  let enabled = true;

  function getSnapshot(): RendererTimingsSnapshot {
    const isolated = environment.isIsolated();
    return {
      resolutionLabel: defaultResolutionLabel(isolated),
      crossOriginIsolated: isolated,
      samples: samples.slice(),
      enabled: enabled && environment.isEnabled(),
    };
  }

  function setEnabled(next: boolean) {
    enabled = next;
  }

  function record(name: string, durationMs: number) {
    if (!enabled || !environment.isEnabled()) return;
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const sample: RendererTimingSample = {
      name,
      durationMs,
      at: environment.now(),
    };
    samples = [...samples, sample].slice(-RENDERER_TIMING_MAX_SAMPLES);
  }

  function measure<T>(name: string, fn: () => T): T {
    if (!enabled || !environment.isEnabled()) return fn();
    const start = environment.now();
    try {
      return fn();
    } finally {
      record(name, environment.now() - start);
    }
  }

  async function measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    if (!enabled || !environment.isEnabled()) return fn();
    const start = environment.now();
    try {
      return await fn();
    } finally {
      record(name, environment.now() - start);
    }
  }

  function clear() {
    samples = [];
  }

  return { getSnapshot, setEnabled, record, measure, measureAsync, clear };
}

const defaultRing = createRendererTimingRing({
  now: () => performance.now(),
  isIsolated: () => (typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false),
  isEnabled: () => true,
});

export function getRendererTimingsSnapshot(): RendererTimingsSnapshot {
  return defaultRing.getSnapshot();
}

export function recordRendererTiming(name: string, durationMs: number): void {
  defaultRing.record(name, durationMs);
}

export function measureRendererTiming<T>(name: string, fn: () => T): T {
  return defaultRing.measure(name, fn);
}

export async function measureRendererTimingAsync<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return defaultRing.measureAsync(name, fn);
}

export function setRendererTimingsEnabled(enabled: boolean): void {
  defaultRing.setEnabled(enabled);
}

export function clearRendererTimings(): void {
  defaultRing.clear();
}
