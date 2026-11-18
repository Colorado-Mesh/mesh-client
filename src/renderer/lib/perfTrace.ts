/**
 * Opt-in renderer tracing: set localStorage `mesh-client:perf=1`, then reload.
 * Zero cost when off (boolean check only; no marks/allocations).
 */

interface PerfSpanStats {
  count: number;
  totalMs: number;
  maxMs: number;
}

const MAX_SPAN_ENTRIES = 64;

export const PERF_TRACE_ENABLED = (() => {
  try {
    const storage = globalThis.localStorage;
    return storage.getItem('mesh-client:perf') === '1';
  } catch {
    // catch-no-log-ok: tracing must never break startup on blocked storage
    return false;
  }
})();

const statsByName = new Map<string, PerfSpanStats>();

function recordSpan(name: string, durationMs: number): void {
  let stats = statsByName.get(name);
  if (!stats) {
    if (statsByName.size >= MAX_SPAN_ENTRIES) return;
    stats = { count: 0, totalMs: 0, maxMs: 0 };
    statsByName.set(name, stats);
  }
  stats.count += 1;
  stats.totalMs += durationMs;
  if (durationMs > stats.maxMs) stats.maxMs = durationMs;
}

/** Run `fn` and record wall time when tracing is enabled. */
export function perfSpan(name: string, fn: () => void): void {
  if (!PERF_TRACE_ENABLED) {
    fn();
    return;
  }
  const t0 = performance.now();
  try {
    fn();
  } finally {
    recordSpan(name, performance.now() - t0);
  }
}

/** Like {@link perfSpan} but returns the function result. */
export function perfSpanSync<T>(name: string, fn: () => T): T {
  if (!PERF_TRACE_ENABLED) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    recordSpan(name, performance.now() - t0);
  }
}

/** Dump span stats via `console.table` (count / total / max / avg ms). */
export function perfReport(): void {
  const rows = [...statsByName.entries()]
    .map(([name, s]) => ({
      name,
      count: s.count,
      totalMs: Number(s.totalMs.toFixed(3)),
      maxMs: Number(s.maxMs.toFixed(3)),
      avgMs: Number((s.totalMs / Math.max(1, s.count)).toFixed(3)),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
  console.table(rows);
  // Lazy import keeps lag probe out of the cold path when tracing is off at module load.
  void import('./mainThreadLagProbe').then(({ mainThreadLagSnapshot, startMainThreadLagProbe }) => {
    startMainThreadLagProbe();
    console.debug('[perf] mainThreadLag', mainThreadLagSnapshot());
  });
}

/** Clear accumulated stats (tests / between bursts). */
export function perfReset(): void {
  statsByName.clear();
}

declare global {
  var __meshPerf: (() => void) | undefined;
}

if (import.meta.env.DEV || PERF_TRACE_ENABLED) {
  globalThis.__meshPerf = perfReport;
}
