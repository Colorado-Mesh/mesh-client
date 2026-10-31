import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import {
  createRendererMemoryAutoSampler,
  RENDERER_MEMORY_AUTO_SAMPLE_CHANNEL,
} from './renderer-memory-auto-sampler';
import { summarizeRendererMemorySamples } from './renderer-memory-samples';

function openMemoryDb(): NodeSqliteDB {
  const db = new NodeSqliteDB(':memory:');
  db.execScript(`
    CREATE TABLE renderer_memory_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      source TEXT NOT NULL,
      app_version TEXT,
      session_id TEXT
    );
  `);
  return db;
}

describe('createRendererMemoryAutoSampler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('persists a process sample, pushes to the renderer, and keeps scheduling', () => {
    const db = openMemoryDb();
    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: {
        getOSProcessId: () => 42,
        send,
      },
    };
    let nextTimerId = 1;
    const pending = new Map<number, { fn: () => void; ms: number }>();
    // Must be within retention age — insert prunes with real Date.now().
    const capturedAt = Date.now();
    const sampler = createRendererMemoryAutoSampler({
      getWindow: () => win as never,
      getDb: () => db,
      getAppMetrics: () => [{ pid: 42, type: 'Tab', memory: { workingSetSize: 2048 } }],
      getAppVersion: () => '9.9.9',
      now: () => capturedAt,
      random: () => 0.5,
      intervalMs: 10_000,
      initialDelayMs: 0,
      sessionId: 'main-test',
      schedule: (fn, ms) => {
        const id = nextTimerId++;
        pending.set(id, { fn, ms });
        return id;
      },
      clearSchedule: (id) => {
        pending.delete(id as number);
      },
    });
    const flushOne = (expectedMs: number) => {
      const entry = [...pending.entries()][0];
      expect(entry).toBeDefined();
      if (!entry) throw new Error('expected a pending auto-sample timer');
      const [id, job] = entry;
      expect(job.ms).toBe(expectedMs);
      pending.delete(id);
      job.fn();
    };
    sampler.start();
    expect(summarizeRendererMemorySamples(db).count).toBe(0);
    flushOne(0);
    expect(send).toHaveBeenCalledWith(RENDERER_MEMORY_AUTO_SAMPLE_CHANNEL, {
      capturedAt,
      bytes: 2048 * 1024,
      source: 'renderer-process',
    });
    expect(summarizeRendererMemorySamples(db)).toMatchObject({
      count: 1,
      minBytes: 2048 * 1024,
      maxBytes: 2048 * 1024,
    });
    flushOne(10_000);
    expect(summarizeRendererMemorySamples(db).count).toBe(2);
    sampler.stop();
    expect(pending.size).toBe(0);
    db.close();
  });

  it('skips destroyed windows and keeps the interval alive after a missing metric', () => {
    const db = openMemoryDb();
    let destroyed = true;
    let pid = 0;
    const send = vi.fn();
    const win = {
      isDestroyed: () => destroyed,
      webContents: {
        getOSProcessId: () => pid,
        send,
      },
    };
    const sampler = createRendererMemoryAutoSampler({
      getWindow: () => win as never,
      getDb: () => db,
      getAppMetrics: () => (pid > 0 ? [{ pid, type: 'Tab', memory: { workingSetSize: 512 } }] : []),
      getAppVersion: () => '1.0.0',
      random: () => 0.5,
      intervalMs: 5_000,
      initialDelayMs: 0,
      sessionId: 'main-test',
    });
    sampler.start();
    vi.advanceTimersByTime(0);
    expect(summarizeRendererMemorySamples(db).count).toBe(0);
    destroyed = false;
    pid = 7;
    vi.advanceTimersByTime(5_000);
    expect(summarizeRendererMemorySamples(db).count).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    sampler.stop();
    db.close();
  });

  it('continues after a persist failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: {
        getOSProcessId: () => 3,
        send,
      },
    };
    const sampler = createRendererMemoryAutoSampler({
      getWindow: () => win as never,
      getDb: () =>
        ({
          prepare: () => {
            throw new Error('db locked');
          },
        }) as never,
      getAppMetrics: () => [{ pid: 3, type: 'Tab', memory: { workingSetSize: 100 } }],
      getAppVersion: () => '1.0.0',
      random: () => 0.5,
      intervalMs: 4_000,
      initialDelayMs: 0,
    });
    sampler.start();
    vi.advanceTimersByTime(0);
    expect(warn).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_000);
    expect(send).toHaveBeenCalledTimes(2);
    sampler.stop();
    warn.mockRestore();
  });
});
