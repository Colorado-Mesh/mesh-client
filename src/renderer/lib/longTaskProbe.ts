/**
 * Always-on Long Task observer → {@link recordRendererTiming} for Support snapshots.
 * No-ops when PerformanceObserver / 'longtask' is unavailable (jsdom, older runtimes).
 */

import { MS_PER_SECOND } from '@/shared/timeConstants';

import { recordRendererTiming } from './rendererTimings';

export const MIN_LONG_TASK_MS = 200;
const LONG_TASK_LOG_MS = 1000;
const LONG_TASK_LOG_COOLDOWN_MS = 30 * MS_PER_SECOND;

let started = false;
let observer: PerformanceObserver | null = null;
let lastLongTaskLogAt = 0;

function supportsLongTaskObserver(): boolean {
  if (typeof PerformanceObserver === 'undefined') return false;
  const supported = (PerformanceObserver as unknown as { supportedEntryTypes?: readonly string[] })
    .supportedEntryTypes;
  return Array.isArray(supported) && supported.includes('longtask');
}

function maybeLogLongTask(durationMs: number): void {
  if (durationMs < LONG_TASK_LOG_MS) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastLongTaskLogAt < LONG_TASK_LOG_COOLDOWN_MS) return;
  lastLongTaskLogAt = now;
  console.debug(`[longTaskProbe] longTask ${Math.round(durationMs)}ms`);
}

/** Start observing long tasks. Idempotent. */
export function startLongTaskProbe(): void {
  if (started) return;
  started = true;
  if (!supportsLongTaskObserver()) return;
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < MIN_LONG_TASK_MS) continue;
        const durationMs = Math.round(entry.duration);
        recordRendererTiming('longTask', durationMs);
        maybeLogLongTask(durationMs);
      }
    });
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    // catch-no-log-ok: probe must never break renderer boot
    observer = null;
  }
}

/** Stop the observer (tests / teardown). */
export function stopLongTaskProbe(): void {
  observer?.disconnect();
  observer = null;
  started = false;
  lastLongTaskLogAt = 0;
}
