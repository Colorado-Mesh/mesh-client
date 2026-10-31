import type { ElectronAPI } from '@/shared/electron-api.types';

import { errLikeToLogString } from './errLikeToLogString';

export const COI_MEMORY_MAX_SAMPLES = 24;

export interface CoiMemorySample {
  at: number;
  bytes: number;
  source?: 'user-agent' | 'renderer-process';
}

export interface CoiMemorySnapshot {
  crossOriginIsolated: boolean;
  supported: boolean;
  sampling: boolean;
  failed: boolean;
  samples: readonly CoiMemorySample[];
}

interface MemoryPerformance extends Performance {
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
}

interface MemorySamplerEnvironment {
  isIsolated: () => boolean;
  getMeasure: () => (() => Promise<{ bytes: number }>) | undefined;
  getProcessMeasure?: () => (() => Promise<{ bytes: number }>) | undefined;
  isVisible: () => boolean;
  /** Main-owned 2h process samples; do not re-persist (main already wrote SQLite). */
  onAutoSample?: (listener: (sample: CoiMemorySample) => void) => () => void;
  now: () => number;
}

/** Retain only totals: browser attribution may contain document or worker URLs. */
export function createCoiMemorySampler(environment: MemorySamplerEnvironment) {
  let browserUnavailable = false;
  const supported = () =>
    Boolean((!browserUnavailable && environment.getMeasure()) || environment.getProcessMeasure?.());
  let snapshot: CoiMemorySnapshot = {
    crossOriginIsolated: environment.isIsolated(),
    supported: supported(),
    sampling: false,
    failed: false,
    samples: [],
  };
  const listeners = new Set<() => void>();
  const owners = new Set<symbol>();
  let unsubscribeAuto: (() => void) | undefined;
  let inFlight: Promise<CoiMemorySample | null> | null = null;
  let generation = 0;

  function update(next: Partial<CoiMemorySnapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }

  /** Manual Sample now: UA needs a visible COI document; process works when visible too. */
  function canAttemptSample() {
    if (!environment.isVisible() || !supported()) return false;
    if (environment.isIsolated()) return true;
    return Boolean(environment.getProcessMeasure?.());
  }

  function appendSample(sample: CoiMemorySample) {
    const previous = snapshot.samples.at(-1);
    const history = previous?.source === sample.source ? snapshot.samples : [];
    update({ samples: [...history, sample].slice(-COI_MEMORY_MAX_SAMPLES), failed: false });
  }

  /** Main auto-sample push — updates the Support ring only. */
  function ingestExternalSample(sample: CoiMemorySample): void {
    if (
      !Number.isFinite(sample.at) ||
      !Number.isFinite(sample.bytes) ||
      sample.bytes < 0 ||
      (sample.source === 'renderer-process' && sample.bytes === 0)
    ) {
      return;
    }
    appendSample({
      at: sample.at,
      bytes: sample.bytes,
      source: sample.source ?? 'renderer-process',
    });
  }

  function sampleNow(): Promise<CoiMemorySample | null> {
    if (inFlight) return inFlight;
    const crossOriginIsolated = environment.isIsolated();
    update({ crossOriginIsolated, supported: supported() });
    if (!canAttemptSample()) {
      return Promise.resolve(null);
    }
    const requestGeneration = generation;
    update({ sampling: true, failed: false });
    const canSample = () => requestGeneration === generation && canAttemptSample();
    // Defer the call so a synchronous throw also follows the failure/cleanup path.
    inFlight = Promise.resolve()
      .then(async (): Promise<Omit<CoiMemorySample, 'at'> | null> => {
        if (!canSample()) return null;
        // Browser UA totals require isolation; skip them on force-file recovery.
        const measure =
          crossOriginIsolated && !browserUnavailable ? environment.getMeasure() : undefined;
        if (measure) {
          try {
            return { bytes: (await measure()).bytes };
          } catch (error) {
            if (
              !error ||
              typeof error !== 'object' ||
              !('name' in error) ||
              error.name !== 'SecurityError' ||
              !environment.getProcessMeasure?.()
            ) {
              throw error;
            }
            // Electron may expose the browser API while disabling its measurement service.
            browserUnavailable = true;
            console.debug('[coiMemorySampler] Browser memory unavailable; using renderer process');
          }
        }
        if (!canSample()) return null;
        const measureProcess = environment.getProcessMeasure?.();
        if (!measureProcess) throw new Error('Renderer memory measurement unavailable');
        const result = await measureProcess();
        return { bytes: result.bytes, source: 'renderer-process' };
      })
      .then((result) => {
        if (!result || !canSample()) return null;
        if (
          !Number.isFinite(result.bytes) ||
          result.bytes < 0 ||
          (result.source === 'renderer-process' && result.bytes === 0)
        ) {
          throw new Error('Invalid renderer memory total');
        }
        const sample = { at: environment.now(), ...result };
        // Browser estimates and OS working sets have different scopes; start a new trend.
        appendSample(sample);
        persistRendererMemorySample(sample);
        return sample;
      })
      .catch((error: unknown) => {
        if (requestGeneration === generation) {
          console.warn('[coiMemorySampler] measurement failed ' + errLikeToLogString(error));
          update({ failed: true });
        }
        return null;
      })
      .finally(() => {
        if (requestGeneration !== generation) return;
        inFlight = null;
        update({ sampling: false });
      });
    return inFlight;
  }

  function start() {
    const owner = Symbol();
    owners.add(owner);
    if (owners.size === 1) {
      update({
        crossOriginIsolated: environment.isIsolated(),
        supported: supported(),
      });
      unsubscribeAuto = environment.onAutoSample?.(ingestExternalSample);
    }
    return () => {
      if (!owners.delete(owner) || owners.size > 0) return;
      unsubscribeAuto?.();
      unsubscribeAuto = undefined;
      generation += 1;
      inFlight = null;
      update({ sampling: false });
    };
  }

  return {
    start,
    sampleNow,
    ingestExternalSample,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const RENDERER_MEMORY_SESSION_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}`;

function persistRendererMemorySample(sample: CoiMemorySample): void {
  if (typeof window === 'undefined') return;
  const record = (window as { electronAPI?: ElectronAPI }).electronAPI?.db
    .recordRendererMemorySample;
  if (!record) return;
  void record({
    capturedAt: sample.at,
    bytes: sample.bytes,
    source: sample.source ?? 'user-agent',
    sessionId: RENDERER_MEMORY_SESSION_ID,
  }).catch((error: unknown) => {
    console.warn('[coiMemorySampler] persist failed ' + errLikeToLogString(error));
  });
}

function subscribeMainAutoSamples(listener: (sample: CoiMemorySample) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const subscribe = (window as { electronAPI?: ElectronAPI }).electronAPI?.db
    .onRendererMemoryAutoSample;
  if (!subscribe) return () => {};
  return subscribe((payload) => {
    listener({
      at: payload.capturedAt,
      bytes: payload.bytes,
      source: payload.source,
    });
  });
}

const sampler = createCoiMemorySampler({
  isIsolated: () => (typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false),
  getMeasure: () => {
    const memoryPerformance = performance as MemoryPerformance;
    return memoryPerformance.measureUserAgentSpecificMemory?.bind(memoryPerformance);
  },
  getProcessMeasure: () => {
    if (typeof window === 'undefined') return undefined;
    // Browser development installs its bridge after module initialization.
    const getLiveness = (window as { electronAPI?: ElectronAPI }).electronAPI?.app
      .getRendererLiveness;
    if (!getLiveness) return undefined;
    return async () => {
      const { rendererProcessMemoryBytes } = await getLiveness();
      if (rendererProcessMemoryBytes === undefined) {
        throw new Error('Renderer process memory metric unavailable');
      }
      return { bytes: rendererProcessMemoryBytes };
    };
  },
  isVisible: () => !document.hidden,
  onAutoSample: subscribeMainAutoSamples,
  now: () => Date.now(),
});

export const startCoiMemorySampler = sampler.start;
export const sampleCoiMemoryNow = sampler.sampleNow;
export const getCoiMemorySnapshot = sampler.getSnapshot;
export const subscribeCoiMemorySnapshot = sampler.subscribe;
