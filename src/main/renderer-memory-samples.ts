import { MS_PER_DAY } from '../shared/timeConstants';
import type { NodeSqliteDB } from './db-compat';

export const RENDERER_MEMORY_SAMPLE_MAX_ROWS = 500;
export const RENDERER_MEMORY_SAMPLE_MAX_AGE_MS = 30 * MS_PER_DAY;

export type RendererMemorySampleSource = 'user-agent' | 'renderer-process';

export interface RendererMemorySampleRow {
  captured_at: number;
  bytes: number;
  source: RendererMemorySampleSource;
  app_version: string | null;
  session_id: string | null;
  js_heap_bytes?: number | null;
  total_js_heap_bytes?: number | null;
  dom_nodes?: number | null;
}

export interface RendererMemorySampleSummary {
  count: number;
  firstAt: number | null;
  lastAt: number | null;
  minBytes: number | null;
  maxBytes: number | null;
  spanMs: number | null;
}

export function insertRendererMemorySample(
  db: NodeSqliteDB,
  sample: RendererMemorySampleRow,
): void {
  db.prepare(
    `INSERT INTO renderer_memory_samples (
       captured_at, bytes, source, app_version, session_id,
       js_heap_bytes, total_js_heap_bytes, dom_nodes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sample.captured_at,
    sample.bytes,
    sample.source,
    sample.app_version,
    sample.session_id,
    sample.js_heap_bytes ?? null,
    sample.total_js_heap_bytes ?? null,
    sample.dom_nodes ?? null,
  );
  pruneRendererMemorySamples(db, Date.now());
}

export function pruneRendererMemorySamples(db: NodeSqliteDB, now: number): void {
  const cutoff = now - RENDERER_MEMORY_SAMPLE_MAX_AGE_MS;
  db.prepare(`DELETE FROM renderer_memory_samples WHERE captured_at < ?`).run(cutoff);
  const countRow = db.prepare(`SELECT COUNT(*) AS c FROM renderer_memory_samples`).get() as
    { c: number } | undefined;
  const count = countRow?.c ?? 0;
  if (count <= RENDERER_MEMORY_SAMPLE_MAX_ROWS) return;
  const excess = count - RENDERER_MEMORY_SAMPLE_MAX_ROWS;
  db.prepare(
    `DELETE FROM renderer_memory_samples WHERE id IN (
       SELECT id FROM renderer_memory_samples ORDER BY captured_at ASC LIMIT ?
     )`,
  ).run(excess);
}

export function summarizeRendererMemorySamples(db: NodeSqliteDB): RendererMemorySampleSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              MIN(captured_at) AS firstAt,
              MAX(captured_at) AS lastAt,
              MIN(bytes) AS minBytes,
              MAX(bytes) AS maxBytes
       FROM renderer_memory_samples`,
    )
    .get() as {
    count: number;
    firstAt: number | null;
    lastAt: number | null;
    minBytes: number | null;
    maxBytes: number | null;
  };
  const spanMs =
    row.firstAt != null && row.lastAt != null ? Math.max(0, row.lastAt - row.firstAt) : null;
  return {
    count: row.count,
    firstAt: row.firstAt,
    lastAt: row.lastAt,
    minBytes: row.minBytes,
    maxBytes: row.maxBytes,
    spanMs,
  };
}

export interface RendererMemorySampleListItem {
  capturedAt: number;
  bytes: number;
  source: RendererMemorySampleSource;
  appVersion: string | null;
  sessionId: string | null;
  jsHeapBytes: number | null;
  totalJsHeapBytes: number | null;
  domNodes: number | null;
}

/** Newest `limit` rows, returned oldest→newest for sparkline / export time series. */
export function listRendererMemorySamples(
  db: NodeSqliteDB,
  options?: { limit?: number },
): RendererMemorySampleListItem[] {
  const rawLimit = options?.limit ?? RENDERER_MEMORY_SAMPLE_MAX_ROWS;
  const limit = Math.min(
    RENDERER_MEMORY_SAMPLE_MAX_ROWS,
    Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : RENDERER_MEMORY_SAMPLE_MAX_ROWS),
  );
  const rows = db
    .prepare(
      `SELECT captured_at AS capturedAt,
              bytes,
              source,
              app_version AS appVersion,
              session_id AS sessionId,
              js_heap_bytes AS jsHeapBytes,
              total_js_heap_bytes AS totalJsHeapBytes,
              dom_nodes AS domNodes
       FROM renderer_memory_samples
       ORDER BY captured_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    capturedAt: number;
    bytes: number;
    source: RendererMemorySampleSource;
    appVersion: string | null;
    sessionId: string | null;
    jsHeapBytes: number | null;
    totalJsHeapBytes: number | null;
    domNodes: number | null;
  }[];
  rows.reverse();
  return rows;
}

export interface RendererMemorySampleExport extends RendererMemorySampleSummary {
  samples: RendererMemorySampleListItem[];
}

/** Summary plus retention-bounded rows for Support / debug exports. */
export function exportRendererMemorySamples(db: NodeSqliteDB): RendererMemorySampleExport {
  return {
    ...summarizeRendererMemorySamples(db),
    samples: listRendererMemorySamples(db),
  };
}
