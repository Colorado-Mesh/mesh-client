import type { BrowserWindow } from 'electron';

import { RENDERER_MEMORY_AUTO_SAMPLE_INTERVAL_MS } from '../shared/timeConstants';
import type { NodeSqliteDB } from './db-compat';
import { insertRendererMemorySample } from './renderer-memory-samples';
import { rendererProcessMemoryBytes } from './rendererProcessMemory';
import { sanitizeLogMessage } from './sanitize-log-message';

export const RENDERER_MEMORY_AUTO_SAMPLE_CHANNEL = 'renderer-memory:auto-sample';

/** Delay before the first sample so the renderer can subscribe after load. */
export const RENDERER_MEMORY_AUTO_SAMPLE_INITIAL_DELAY_MS = 5_000;

export interface RendererMemoryAutoSamplePayload {
  capturedAt: number;
  bytes: number;
  source: 'renderer-process';
}

export interface RendererMemoryAutoSamplerDeps {
  getWindow: () => BrowserWindow | null;
  getDb: () => NodeSqliteDB | null;
  getAppMetrics: () => Parameters<typeof rendererProcessMemoryBytes>[0];
  getAppVersion: () => string;
  now?: () => number;
  random?: () => number;
  intervalMs?: number;
  initialDelayMs?: number;
  sessionId?: string;
  schedule?: (fn: () => void, ms: number) => unknown;
  clearSchedule?: (id: unknown) => void;
}

export function createRendererMemoryAutoSampler(deps: RendererMemoryAutoSamplerDeps) {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const intervalMs = deps.intervalMs ?? RENDERER_MEMORY_AUTO_SAMPLE_INTERVAL_MS;
  const initialDelayMs = deps.initialDelayMs ?? RENDERER_MEMORY_AUTO_SAMPLE_INITIAL_DELAY_MS;
  const schedule: (fn: () => void, ms: number) => unknown =
    deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const clearSchedule: (id: unknown) => void =
    deps.clearSchedule ??
    ((id) => {
      clearTimeout(id as ReturnType<typeof setTimeout>);
    });
  const sessionId = deps.sessionId ?? `main-${now()}`;

  let timer: unknown;
  let running = false;

  function clearTimer() {
    if (timer === undefined) return;
    clearSchedule(timer);
    timer = undefined;
  }

  function nextIntervalMs(): number {
    // Jitter prevents periodic work from aligning across installs.
    return intervalMs * (0.8 + random() * 0.4);
  }

  function takeSample(): void {
    const win = deps.getWindow();
    if (!win || win.isDestroyed()) return;
    let pid: number;
    try {
      pid = win.webContents.getOSProcessId();
    } catch (error: unknown) {
      console.debug(
        '[renderer-memory-auto-sampler] pid unavailable ' +
          sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    const bytes = rendererProcessMemoryBytes(deps.getAppMetrics(), pid);
    if (bytes === undefined) {
      console.debug('[renderer-memory-auto-sampler] working-set metric unavailable');
      return;
    }
    const capturedAt = now();
    const db = deps.getDb();
    if (db) {
      try {
        insertRendererMemorySample(db, {
          captured_at: capturedAt,
          bytes,
          source: 'renderer-process',
          app_version: deps.getAppVersion(),
          session_id: sessionId,
        });
      } catch (error: unknown) {
        console.warn(
          '[renderer-memory-auto-sampler] persist failed ' +
            sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
        );
      }
    }
    if (win.isDestroyed()) return;
    const payload: RendererMemoryAutoSamplePayload = {
      capturedAt,
      bytes,
      source: 'renderer-process',
    };
    try {
      win.webContents.send(RENDERER_MEMORY_AUTO_SAMPLE_CHANNEL, payload);
    } catch (error: unknown) {
      console.debug(
        '[renderer-memory-auto-sampler] push failed ' +
          sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
      );
    }
  }

  function arm(delayMs: number) {
    clearTimer();
    if (!running) return;
    timer = schedule(() => {
      timer = undefined;
      try {
        takeSample();
      } finally {
        if (running) arm(nextIntervalMs());
      }
    }, delayMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      arm(Math.max(0, initialDelayMs));
    },
    stop() {
      running = false;
      clearTimer();
    },
  };
}
