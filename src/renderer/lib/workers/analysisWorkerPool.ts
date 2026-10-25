import { errLikeToLogString } from '../errLikeToLogString';
import { measureRendererTiming, measureRendererTimingAsync } from '../rendererTimings';
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

export function createAnalysisWorkerPool(options: AnalysisWorkerPoolOptions = {}) {
  const canUse = options.canUseWorkers ?? defaultCanUseWorkers;
  const maxWorkers = options.maxWorkers ?? DEFAULT_MAX_WORKERS;
  const cores =
    options.hardwareConcurrency ??
    (typeof navigator !== 'undefined' ? Math.max(1, navigator.hardwareConcurrency) : 1);
  let worker: Worker | null = null;
  const pending = new Map<
    number,
    { resolve: (value: AnalysisJobResult) => void; reject: (reason: unknown) => void }
  >();

  function budget(): number {
    return canUse() ? workerBudget(cores, maxWorkers) : 0;
  }

  function attachWorker(next: Worker): Worker {
    next.onmessage = (event: MessageEvent<AnalysisWorkerOutbound>) => {
      const data = event.data;
      const waiter = pending.get(data.sequence);
      if (!waiter) return;
      pending.delete(data.sequence);
      if (data.kind === 'error') {
        waiter.reject(new Error(data.error));
        return;
      }
      waiter.resolve(data);
    };
    next.onerror = (event) => {
      console.warn('[analysisWorkerPool] worker error ' + errLikeToLogString(event.message));
      for (const [seq, waiter] of pending) {
        pending.delete(seq);
        waiter.reject(new Error(event.message || 'analysis worker error'));
      }
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
        pending.set(request.sequence, { resolve, reject });
        try {
          w.postMessage(request);
        } catch (err) {
          pending.delete(request.sequence);
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
    for (const [seq, waiter] of pending) {
      pending.delete(seq);
      waiter.reject(new Error('analysis worker disposed'));
    }
    disposeWorker();
  }

  return {
    run,
    runInline,
    dispose,
    wouldUseWorker: () => budget() > 0 && Boolean(options.createWorker),
    workerBudget: budget,
  };
}

export type AnalysisWorkerPool = ReturnType<typeof createAnalysisWorkerPool>;

let defaultPool: AnalysisWorkerPool | null = null;
let viteWorkerReady: Promise<void> | null = null;

function ensureViteWorkerPool(): Promise<void> {
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
