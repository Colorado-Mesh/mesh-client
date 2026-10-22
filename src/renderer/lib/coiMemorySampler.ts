import { errLikeToLogString } from './errLikeToLogString';
import { COI_MEMORY_SAMPLE_INTERVAL_MS } from './timeConstants';

export const COI_MEMORY_MAX_SAMPLES = 24;

export interface CoiMemorySample {
  at: number;
  bytes: number;
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
  isVisible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  now: () => number;
  random: () => number;
}

/** Retain only totals: browser attribution may contain document or worker URLs. */
export function createCoiMemorySampler(environment: MemorySamplerEnvironment) {
  let snapshot: CoiMemorySnapshot = {
    crossOriginIsolated: environment.isIsolated(),
    supported: Boolean(environment.getMeasure()),
    sampling: false,
    failed: false,
    samples: [],
  };
  const listeners = new Set<() => void>();
  const owners = new Set<symbol>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeVisibility: (() => void) | undefined;
  let inFlight: Promise<CoiMemorySample | null> | null = null;
  let generation = 0;

  function update(next: Partial<CoiMemorySnapshot>) {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    clearTimer();
    if (
      owners.size === 0 ||
      !environment.isVisible() ||
      !environment.isIsolated() ||
      !environment.getMeasure() ||
      inFlight
    ) {
      return;
    }
    // Jitter prevents periodic app work from consistently biasing measurements.
    const interval = COI_MEMORY_SAMPLE_INTERVAL_MS * (0.8 + environment.random() * 0.4);
    timer = setTimeout(() => {
      timer = undefined;
      void sampleNow();
    }, interval);
  }

  function sampleNow(): Promise<CoiMemorySample | null> {
    if (inFlight) return inFlight;
    const measure = environment.getMeasure();
    const crossOriginIsolated = environment.isIsolated();
    update({ crossOriginIsolated, supported: Boolean(measure) });
    if (!crossOriginIsolated || !measure || !environment.isVisible()) {
      return Promise.resolve(null);
    }
    clearTimer();
    const requestGeneration = generation;
    update({ sampling: true, failed: false });
    // Defer the call so a synchronous throw also follows the failure/cleanup path.
    inFlight = Promise.resolve()
      .then(measure)
      .then((result) => {
        if (requestGeneration !== generation) return null;
        if (!Number.isFinite(result.bytes) || result.bytes < 0) {
          throw new Error('Invalid renderer memory total');
        }
        const sample = { at: environment.now(), bytes: result.bytes };
        update({ samples: [...snapshot.samples, sample].slice(-COI_MEMORY_MAX_SAMPLES) });
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
        schedule();
      });
    return inFlight;
  }

  function start() {
    const owner = Symbol();
    owners.add(owner);
    if (owners.size === 1) {
      update({
        crossOriginIsolated: environment.isIsolated(),
        supported: Boolean(environment.getMeasure()),
      });
      unsubscribeVisibility = environment.onVisibilityChange(schedule);
      schedule();
    }
    return () => {
      if (!owners.delete(owner) || owners.size > 0) return;
      clearTimer();
      unsubscribeVisibility?.();
      unsubscribeVisibility = undefined;
      generation += 1;
      inFlight = null;
      update({ sampling: false });
    };
  }

  return {
    start,
    sampleNow,
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const sampler = createCoiMemorySampler({
  isIsolated: () => (typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false),
  getMeasure: () => {
    const memoryPerformance = performance as MemoryPerformance;
    return memoryPerformance.measureUserAgentSpecificMemory?.bind(memoryPerformance);
  },
  isVisible: () => !document.hidden,
  onVisibilityChange: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => {
      document.removeEventListener('visibilitychange', listener);
    };
  },
  now: () => Date.now(),
  random: () => Math.random(),
});

export const startCoiMemorySampler = sampler.start;
export const sampleCoiMemoryNow = sampler.sampleNow;
export const getCoiMemorySnapshot = sampler.getSnapshot;
export const subscribeCoiMemorySnapshot = sampler.subscribe;
