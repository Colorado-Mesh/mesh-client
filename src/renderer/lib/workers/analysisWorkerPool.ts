import { errLikeToLogString } from '../errLikeToLogString';
import { measureRendererTiming, measureRendererTimingAsync } from '../rendererTimings';
import { ANALYSIS_WORKER_REQUEST_TIMEOUT_MS } from '../timeConstants';
import { runAnalysisJob } from './analysisJobHandlers';
import type {
  AnalysisJobRequest,
  AnalysisJobResult,
  AnalysisWorkerOutbound,
} from './analysisJobTypes';

export interface AnalysisWorkerPoolOptions {
  canUseWorkers?: () => boolean;
  createWorker?: () => Worker;
  maxWorkers?: number;
  hardwareConcurrency?: number;
}

const DEFAULT_MAX_WORKERS = 2;

export function defaultCanUseWorkers(): boolean {
  const isolated = typeof crossOriginIsolated === 'boolean' ? crossOriginIsolated : false;
  return isolated && typeof SharedArrayBuffer === 'function';
}

/** Leave headroom for the UI and Catch-up WASM pthread pool. */
export function workerBudget(cores: number, maxWorkers: number = DEFAULT_MAX_WORKERS): number {
  if (cores <= 1) return 0;
  return Math.max(0, Math.min(maxWorkers, Math.floor(cores / 2) - 1, cores - 1));
}

let sequenceCounter = 0;

export function nextAnalysisSequence(): number {
  sequenceCounter += 1;
  return sequenceCounter;
}

interface PendingWaiter {
  resolve: (value: AnalysisJobResult) => void;
  reject: (reason: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export function createAnalysisWorkerPool(options: AnalysisWorkerPoolOptions = {}) {
  const canUse = options.canUseWorkers ?? defaultCanUseWorkers;
  const maxWorkers = options.maxWorkers ?? DEFAULT_MAX_WORKERS;
  const cores =
    options.hardwareConcurrency ??
    (typeof navigator !== 'undefined' ? Math.max(1, navigator.hardwareConcurrency) : 1);
  let worker: Worker | null = null;
  const pending = new Map<number, PendingWaiter>();

  function budget(): number {
    return canUse() ? workerBudget(cores, maxWorkers) : 0;
  }

  function clearPending(sequence: number): PendingWaiter | undefined {
    const waiter = pending.get(sequence);
    if (!waiter) return undefined;
    pending.delete(sequence);
    clearTimeout(waiter.timeoutId);
    return waiter;
  }

  function rejectAllPending(reason: Error): void {
    for (const [seq, waiter] of pending) {
      pending.delete(seq);
      clearTimeout(waiter.timeoutId);
      waiter.reject(reason);
    }
  }

  function attachWorker(next: Worker): Worker {
    next.onmessage = (event: MessageEvent<AnalysisWorkerOutbound>) => {
      const data = event.data;
      const waiter = clearPending(data.sequence);
      if (!waiter) return;
      if (data.kind === 'error') {
        waiter.reject(new Error(data.error));
        return;
      }
      waiter.resolve(data);
    };
    next.onerror = (event) => {
      console.warn('[analysisWorkerPool] worker error ' + errLikeToLogString(event.message));
      rejectAllPending(new Error(event.message || 'analysis worker error'));
      disposeWorker();
    };
    return next;
  }

  function ensureWorker(): Worker | null {
    if (budget() <= 0) return null;
    if (worker) return worker;
    if (!options.createWorker) return null;
    try {
      worker = attachWorker(options.createWorker());
      return worker;
    } catch (err) {
      console.debug('[analysisWorkerPool] worker create failed ' + errLikeToLogString(err));
      worker = null;
      return null;
    }
  }

  function disposeWorker() {
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  function runInline(request: AnalysisJobRequest): AnalysisJobResult {
    const timingName = request.kind === 'topologyBuild' ? 'topologyBuild' : 'diagnosticsPass';
    return measureRendererTiming(timingName, () => runAnalysisJob(request));
  }

  async function run(request: AnalysisJobRequest): Promise<AnalysisJobResult> {
    const timingName = request.kind === 'topologyBuild' ? 'topologyBuild' : 'diagnosticsPass';
    return measureRendererTimingAsync(timingName, async () => {
      const w = ensureWorker();
      if (!w) return runAnalysisJob(request);
      return new Promise<AnalysisJobResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (!pending.has(request.sequence)) return;
          // Wedged worker: drop it and fail every waiter so ensureWorker() can recreate.
          disposeWorker();
          rejectAllPending(new Error('analysis worker request timed out'));
        }, ANALYSIS_WORKER_REQUEST_TIMEOUT_MS);
        pending.set(request.sequence, { resolve, reject, timeoutId });
        try {
          w.postMessage(request);
        } catch (err) {
          clearPending(request.sequence);
          console.debug(
            '[analysisWorkerPool] postMessage failed; inline ' + errLikeToLogString(err),
          );
          try {
            resolve(runAnalysisJob(request));
          } catch (inlineErr) {
            // catch-no-log-ok already logged postMessage failure; surface inline failure to caller
            reject(inlineErr instanceof Error ? inlineErr : new Error(String(inlineErr)));
          }
        }
      });
    });
  }

  function dispose() {
    rejectAllPending(new Error('analysis worker disposed'));
    disposeWorker();
  }

  return {
    run,
    runInline,
    dispose,
    wouldUseWorker: () => budget() > 0 && Boolean(options.createWorker),
    /** True when a worker is attached (budget + successful create). */
    hasAttachedWorker: () => budget() > 0 && worker != null,
    /** Create/attach a worker when possible; returns whether one is ready. */
    ensureAttachedWorker: () => ensureWorker() != null,
    workerBudget: budget,
  };
}

export type AnalysisWorkerPool = ReturnType<typeof createAnalysisWorkerPool>;

let defaultPool: AnalysisWorkerPool | null = null;
let viteWorkerReady: Promise<void> | null = null;

export function ensureViteWorkerPool(): Promise<void> {
  if (viteWorkerReady) return viteWorkerReady;
  viteWorkerReady = (async () => {
    if (!defaultCanUseWorkers()) {
      defaultPool ??= createAnalysisWorkerPool();
      return;
    }
    try {
      const mod = await import('../../workers/analysis.worker?worker');
      const Ctor = mod.default;
      defaultPool?.dispose();
      defaultPool = createAnalysisWorkerPool({
        createWorker: () => new Ctor(),
      });
    } catch (err) {
      console.debug('[analysisWorkerPool] ?worker import failed ' + errLikeToLogString(err));
      defaultPool ??= createAnalysisWorkerPool();
    }
  })();
  return viteWorkerReady;
}

/**
 * After Vite worker bootstrap, true only when a positive budget and an attached worker exist.
 */
export async function analysisWorkersAvailable(): Promise<boolean> {
  await ensureViteWorkerPool();
  const pool = defaultPool ?? createAnalysisWorkerPool();
  defaultPool = pool;
  return pool.ensureAttachedWorker();
}

/** Prefer this entry point — awaits Vite worker bootstrap when COI+SAB are available. */
export async function runAnalysisRequest(request: AnalysisJobRequest): Promise<AnalysisJobResult> {
  await ensureViteWorkerPool();
  const pool = defaultPool ?? createAnalysisWorkerPool();
  defaultPool = pool;
  return pool.run(request);
}

/** Sync path for tests / callers that must not await. Always inline (no worker). */
export function runAnalysisRequestInline(request: AnalysisJobRequest): AnalysisJobResult {
  return runAnalysisJob(request);
}

export function setAnalysisWorkerPoolForTests(pool: AnalysisWorkerPool | null): void {
  defaultPool?.dispose();
  defaultPool = pool;
  viteWorkerReady = pool ? Promise.resolve() : null;
}

export function getAnalysisWorkerPoolForTests(): AnalysisWorkerPool | null {
  return defaultPool;
}
