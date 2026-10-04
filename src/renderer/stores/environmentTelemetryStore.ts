import { create } from 'zustand';

import {
  ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS,
  ENVIRONMENT_TELEMETRY_MAX_NODES,
  ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  ENVIRONMENT_TELEMETRY_RETENTION_MS,
  type EnvironmentReading,
  type EnvironmentReadingField,
  environmentReadingFromRow,
  environmentReadingsEqual,
  type EnvironmentTelemetrySource,
  sanitizeEnvironmentReading,
} from '@/shared/environmentTelemetry';
import type { MeshProtocol } from '@/shared/meshProtocol';
import { isMeshProtocol } from '@/shared/meshProtocol';

import { errLikeToLogString } from '../lib/errLikeToLogString';

export interface EnvironmentHistoryPoint {
  t: number;
  reading: EnvironmentReading;
  source: EnvironmentTelemetrySource;
}

type NodeSeriesMap = ReadonlyMap<number, readonly EnvironmentHistoryPoint[]>;
type MutableNodeSeriesMap = Map<number, readonly EnvironmentHistoryPoint[]>;

const EMPTY_SERIES: readonly EnvironmentHistoryPoint[] = [];
const EMPTY_NODE_MAP: NodeSeriesMap = new Map();

type HistoryMap = Map<MeshProtocol, MutableNodeSeriesMap>;

interface EnvironmentTelemetryState {
  history: HistoryMap;
  /**
   * Store a reading for one node. Identical readings inside the dedup window are dropped
   * (same packet heard over RF and MQTT). Returns true when the reading was kept.
   */
  recordReading(
    protocol: MeshProtocol,
    nodeId: number,
    reading: EnvironmentReading,
    source: EnvironmentTelemetrySource,
  ): boolean;
  clearHistory(): void;
  loadFromDb(): Promise<void>;
}

/**
 * Drop the expired prefix, keep room for one new point under the per-node cap, and append.
 * One copy of this node's series — callers publish that array and leave every other series put.
 */
function appendBoundedSeries(
  existing: readonly EnvironmentHistoryPoint[],
  point: EnvironmentHistoryPoint,
  now: number,
): readonly EnvironmentHistoryPoint[] {
  const cutoff = now - ENVIRONMENT_TELEMETRY_RETENTION_MS;
  let start = 0;
  const len = existing.length;
  while (start < len && existing[start].t < cutoff) start++;
  const maxKeep = ENVIRONMENT_TELEMETRY_MAX_PER_NODE - 1;
  if (len - start > maxKeep) start = len - maxKeep;
  const next = existing.slice(start);
  next.push(point);
  return next;
}

/**
 * Store `series` for one node. The node map is updated in place so other nodes keep their
 * series arrays (selectors for those nodes do not change). The protocol map is a shallow copy.
 */
function installSeries(
  history: HistoryMap,
  protocol: MeshProtocol,
  nodeId: number,
  series: readonly EnvironmentHistoryPoint[],
): HistoryMap {
  let nodes = history.get(protocol);
  if (!nodes) {
    nodes = new Map();
  } else if (!nodes.has(nodeId) && nodes.size >= ENVIRONMENT_TELEMETRY_MAX_NODES) {
    const firstKey = nodes.keys().next().value;
    if (firstKey !== undefined) nodes.delete(firstKey);
  }
  nodes.set(nodeId, series);
  const next = new Map(history);
  next.set(protocol, nodes);
  return next;
}

/**
 * Per-series cap, then the newest `ENVIRONMENT_TELEMETRY_MAX_NODES` nodes (latest sample,
 * then lower node id). Kept nodes are inserted oldest-first so later FIFO eviction drops
 * the stalest node.
 */
function capLoadedNodes(nodes: Map<number, EnvironmentHistoryPoint[]>): MutableNodeSeriesMap {
  for (const series of nodes.values()) {
    series.sort((a, b) => a.t - b.t);
    if (series.length > ENVIRONMENT_TELEMETRY_MAX_PER_NODE) {
      series.splice(0, series.length - ENVIRONMENT_TELEMETRY_MAX_PER_NODE);
    }
  }
  const ranked = [...nodes.entries()];
  ranked.sort((a, b) => {
    const dt = (a[1].at(-1)?.t ?? 0) - (b[1].at(-1)?.t ?? 0);
    if (dt !== 0) return dt;
    return b[0] - a[0];
  });
  if (ranked.length > ENVIRONMENT_TELEMETRY_MAX_NODES) {
    ranked.splice(0, ranked.length - ENVIRONMENT_TELEMETRY_MAX_NODES);
  }
  return new Map<number, readonly EnvironmentHistoryPoint[]>(ranked);
}

export const useEnvironmentTelemetryStore = create<EnvironmentTelemetryState>((set, get) => ({
  history: new Map(),

  recordReading(protocol, nodeId, reading, source) {
    if (!Number.isInteger(nodeId) || nodeId <= 0) return false;
    const clean = sanitizeEnvironmentReading(reading);
    if (!clean) return false;
    const now = Date.now();
    const existing = get().history.get(protocol)?.get(nodeId) ?? EMPTY_SERIES;
    const last = existing.at(-1);
    if (
      last &&
      now - last.t < ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS &&
      environmentReadingsEqual(last.reading, clean)
    ) {
      return false;
    }
    const series = appendBoundedSeries(existing, { t: now, reading: clean, source }, now);
    set({ history: installSeries(get().history, protocol, nodeId, series) });

    // Fire-and-forget: persistence must never block or drop the live reading.
    const save = window.electronAPI?.db?.saveEnvironmentTelemetry;
    if (typeof save === 'function') {
      save(protocol, nodeId, now, clean, source).catch((err: unknown) => {
        console.warn('[environmentTelemetry] DB write failed: ' + errLikeToLogString(err));
      });
    }
    return true;
  },

  clearHistory() {
    set({ history: new Map() });
    const clear = window.electronAPI?.db?.clearEnvironmentTelemetry;
    if (typeof clear !== 'function') return;
    clear().catch((err: unknown) => {
      console.warn('[environmentTelemetry] clear DB failed: ' + errLikeToLogString(err));
    });
  },

  async loadFromDb() {
    try {
      const sinceMs = Date.now() - ENVIRONMENT_TELEMETRY_RETENTION_MS;
      const rows = await window.electronAPI.db.getEnvironmentTelemetry(sinceMs);
      if (rows.length === 0) return;
      const loaded = new Map<MeshProtocol, Map<number, EnvironmentHistoryPoint[]>>();
      for (const row of rows) {
        if (!isMeshProtocol(row.protocol)) continue;
        const reading = environmentReadingFromRow(row);
        if (Object.keys(reading).length === 0) continue;
        let nodes = loaded.get(row.protocol);
        if (!nodes) {
          nodes = new Map();
          loaded.set(row.protocol, nodes);
        }
        const series = nodes.get(row.node_id) ?? [];
        series.push({
          t: row.recorded_at,
          reading,
          source: row.source === 'mqtt' || row.source === 'rpc' ? row.source : 'rf',
        });
        nodes.set(row.node_id, series);
      }
      // Readings recorded while the DB load was in flight are newer than any row; keep them.
      // SQL already applies both caps; cap again so a large payload cannot exceed them.
      const live = get().history;
      const merged: HistoryMap = new Map();
      for (const [protocol, nodes] of loaded) {
        const liveNodes = live.get(protocol);
        for (const [nodeId, series] of nodes) {
          let lastT = 0;
          for (const p of series) {
            if (p.t > lastT) lastT = p.t;
          }
          for (const p of liveNodes?.get(nodeId) ?? EMPTY_SERIES) {
            if (p.t > lastT) series.push(p);
          }
        }
        for (const [nodeId, series] of liveNodes ?? EMPTY_NODE_MAP) {
          if (!nodes.has(nodeId)) nodes.set(nodeId, [...series]);
        }
        merged.set(protocol, capLoadedNodes(nodes));
      }
      for (const [protocol, nodes] of live) {
        if (!merged.has(protocol)) merged.set(protocol, nodes);
      }
      set({ history: merged });
    } catch (err) {
      console.warn('[environmentTelemetry] loadFromDb failed: ' + errLikeToLogString(err));
    }
  },
}));

/** Stable per-protocol node → series map (module-level empty constant when none). */
export function selectEnvironmentNodes(
  state: Pick<EnvironmentTelemetryState, 'history'>,
  protocol: MeshProtocol,
): NodeSeriesMap {
  return state.history.get(protocol) ?? EMPTY_NODE_MAP;
}

/** Stable series for one node (module-level empty constant when none). */
export function selectEnvironmentSeries(
  state: Pick<EnvironmentTelemetryState, 'history'>,
  protocol: MeshProtocol,
  nodeId: number,
): readonly EnvironmentHistoryPoint[] {
  return state.history.get(protocol)?.get(nodeId) ?? EMPTY_SERIES;
}

/** Readings scanned back from the newest when merging partial variants for display. */
const LATEST_READING_SCAN_LIMIT = 20;

/** Newest value of `metric` in recent points, scanning back from the end (readings may be partial). */
export function latestEnvironmentValue(
  series: readonly EnvironmentHistoryPoint[],
  metric: EnvironmentReadingField,
): { value: number; t: number } | null {
  const stop = Math.max(0, series.length - LATEST_READING_SCAN_LIMIT);
  for (let i = series.length - 1; i >= stop; i--) {
    const p = series[i];
    const v = p.reading[metric];
    if (v !== undefined) return { value: v, t: p.t };
  }
  return null;
}

/** Newest value per field across recent points (a combined "latest reading" for tooltips). */
export function latestEnvironmentReading(
  series: readonly EnvironmentHistoryPoint[],
): EnvironmentReading {
  const out: EnvironmentReading = {};
  const stop = Math.max(0, series.length - LATEST_READING_SCAN_LIMIT);
  for (let i = series.length - 1; i >= stop; i--) {
    const r = series[i].reading;
    for (const key of Object.keys(r) as EnvironmentReadingField[]) {
      out[key] ??= r[key];
    }
  }
  return out;
}

/** Convenience for non-React callers (runtimes, side-effect modules). */
export function recordEnvironmentReading(
  protocol: MeshProtocol,
  nodeId: number,
  reading: EnvironmentReading,
  source: EnvironmentTelemetrySource,
): boolean {
  return useEnvironmentTelemetryStore.getState().recordReading(protocol, nodeId, reading, source);
}
