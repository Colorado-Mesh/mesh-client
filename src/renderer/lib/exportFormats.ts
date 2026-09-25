/** Pure serializers for node / topology / diagnostics exports (no I/O). */

export const TOPOLOGY_EXPORT_FORMAT = 'mesh-client-topology';
export const DIAGNOSTICS_EXPORT_FORMAT = 'mesh-client-diagnostics';
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Stable topology node fields. New fields may be appended; consumers must ignore unknown keys
 * and treat `null` as "not reported".
 */
export const TOPOLOGY_NODE_FIELDS = [
  'node_id',
  'long_name',
  'short_name',
  'status',
  'health_score',
  'channel_utilization',
  'air_util_tx',
  'battery',
  'latitude',
  'longitude',
  'protocol',
  'last_heard',
] as const;

export type TopologyNodeField = (typeof TOPOLOGY_NODE_FIELDS)[number];

export type TopologyNode = Record<TopologyNodeField, unknown>;

export interface TopologyExport {
  format: typeof TOPOLOGY_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  fields: readonly TopologyNodeField[];
  nodeCount: number;
  nodes: TopologyNode[];
}

export interface DiagnosticsExport {
  format: typeof DIAGNOSTICS_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  rowCount: number;
  rows: unknown[];
}

const CSV_EOL = '\r\n';
/** Leading characters spreadsheets interpret as formulas (CSV injection). */
const CSV_FORMULA_PREFIX = /^[=+@\t\r]|^-(?![\d.])/;

function csvCellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'string') {
    return CSV_FORMULA_PREFIX.test(value) ? `'${value}` : value;
  }
  const safe = toJsonSafe(value);
  if (safe === undefined) return '';
  try {
    return JSON.stringify(safe);
  } catch {
    // catch-no-log-ok unserializable cell exported as empty
    return '';
  }
}

function csvEscape(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180 CSV. Columns: known topology fields that appear in any row (canonical order),
 * then remaining keys in first-seen order so new node fields export without code changes.
 */
export function nodesToCsv(rows: Record<string, unknown>[]): string {
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (!(TOPOLOGY_NODE_FIELDS as readonly string[]).includes(key)) extra.push(key);
    }
  }
  const columns = [...TOPOLOGY_NODE_FIELDS.filter((f) => seen.has(f)), ...extra];
  if (columns.length === 0) return '';
  const lines = [columns.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(csvCellText(row[c]))).join(','));
  }
  return lines.join(CSV_EOL) + CSV_EOL;
}

export function nodesToTopologyJson(
  rows: Record<string, unknown>[],
  meta?: { exportedAt?: string },
): TopologyExport {
  const nodes = rows.map((row) => {
    const node = {} as TopologyNode;
    for (const field of TOPOLOGY_NODE_FIELDS) {
      node[field] = toJsonSafe(row[field]) ?? null;
    }
    return node;
  });
  return {
    format: TOPOLOGY_EXPORT_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: meta?.exportedAt ?? new Date().toISOString(),
    fields: TOPOLOGY_NODE_FIELDS,
    nodeCount: nodes.length,
    nodes,
  };
}

export function diagnosticsRowsToJson(
  rows: unknown[],
  meta?: { exportedAt?: string },
): DiagnosticsExport {
  const safeRows = rows.map((r) => toJsonSafe(r) ?? null);
  return {
    format: DIAGNOSTICS_EXPORT_FORMAT,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: meta?.exportedAt ?? new Date().toISOString(),
    rowCount: safeRows.length,
    rows: safeRows,
  };
}

/**
 * Convert runtime values (Maps, Sets, bigint, Dates, cycles) into plain JSON-serializable data.
 * Functions/symbols become `undefined` (dropped from objects); cycles become `"[Circular]"`.
 */
export function toJsonSafe(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (value == null) return value;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return value.toString();
    case 'function':
    case 'symbol':
      return undefined;
    default:
      break;
  }
  const obj = value;
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
  if (ancestors.has(obj)) return '[Circular]';
  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) return obj.map((v) => toJsonSafe(v, ancestors) ?? null);
    if (obj instanceof Set) return [...obj].map((v) => toJsonSafe(v, ancestors) ?? null);
    if (obj instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of obj) {
        const safe = toJsonSafe(v, ancestors);
        if (safe !== undefined) out[String(k)] = safe;
      }
      return out;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const safe = toJsonSafe(v, ancestors);
      if (safe !== undefined) out[k] = safe;
    }
    return out;
  } finally {
    ancestors.delete(obj);
  }
}
