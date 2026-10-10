import { describe, expect, it } from 'vitest';

import { analyzeLogs, type LogEntry } from './logAnalyzer';
import type { MeshProtocol } from './types';

function entry(message: string, level = 'warn', ts = 1000): LogEntry {
  return { ts, level, source: 'main', message };
}

// Fixtures mirror production emitters; keep failure text and harmless counterexamples together.
const fixtures: { category: string; protocol: MeshProtocol; message: string }[] = [
  {
    category: 'renderer-unresponsive',
    protocol: 'meshtastic',
    message: '[main] renderer unresponsive after system resume (no heartbeat within 30s)',
  },
  {
    category: 'renderer-unresponsive',
    protocol: 'meshcore',
    message: '[main] renderer webContents unresponsive',
  },
  {
    category: 'database-persistence',
    protocol: 'meshtastic',
    message:
      '[dbPersistRetry] degraded persistence: saveNode failed after retries: database is locked',
  },
  {
    category: 'database-persistence',
    protocol: 'meshcore',
    message:
      '[dbPersistRetry] degraded persistence: queue full; dropping saveMeshcoreContact: disk full',
  },
  {
    category: 'meshtastic-tcp',
    protocol: 'meshtastic',
    message: '[IPC] meshtastic:tcp-connect error: ECONNREFUSED',
  },
  {
    category: 'meshtastic-tcp',
    protocol: 'meshtastic',
    message: '[IPC] meshtastic:tcp-write error: broken pipe',
  },
];

describe('current production log messages', () => {
  it.each(fixtures)('classifies $category: $message', ({ category, protocol, message }) => {
    const result = analyzeLogs([entry(message)], protocol);
    expect(result.categories.find((finding) => finding.id === category)?.count).toBe(1);
    expect(result.categories.find((finding) => finding.id === 'unclassified')).toBeUndefined();
  });

  it.each(fixtures)('does not diagnose debug-only $category', ({ category, protocol, message }) => {
    expect(
      analyzeLogs([entry(message, 'debug')], protocol).categories.find(
        (finding) => finding.id === category,
      ),
    ).toBeUndefined();
  });
});

describe('finding evidence', () => {
  it('keeps the original messages, newest first, without changing the input', () => {
    const oldest = entry(
      '[dbPersistRetry] degraded persistence: first failed after retries',
      'warn',
      1,
    );
    const newest = entry(
      '[dbPersistRetry] degraded persistence: second failed after retries',
      'warn',
      3,
    );
    const input = [oldest, entry('normal progress', 'info', 2), newest];
    const result = analyzeLogs(input, 'meshtastic');
    const finding = result.categories[0];
    expect(finding.entries).toEqual([newest, oldest]);
    expect(finding.lastTs).toBe(3);
    expect(input[0]).toBe(oldest);
    expect(finding.entries[0]).toBe(newest);
  });

  it('surfaces unmatched errors once, without double-counting recognized warnings', () => {
    const unknown = entry('[FutureModule] request failed', 'error');
    const known = entry('[dbPersistRetry] degraded persistence: save failed after retries');
    const result = analyzeLogs([known, unknown, entry('normal progress', 'info')], 'meshtastic');
    expect(result.categories.find((finding) => finding.id === 'unclassified')).toMatchObject({
      count: 1,
      severity: 'error',
      entries: [unknown],
    });
  });

  it('preserves cancelled-navigation noise suppression in the fallback', () => {
    expect(
      analyzeLogs([entry('[main] Failed to load: -3 ERR_ABORTED', 'error')], 'meshtastic')
        .categories,
    ).toEqual([]);
  });
});
