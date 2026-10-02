import { create } from 'zustand';

import {
  ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS,
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

/** Hard cap on distinct nodes tracked per protocol in memory. */
const MAX_NODES_PER_PROTOCOL = 2000;

export interface EnvironmentHistoryPoint {
  t: number;
  reading: EnvironmentReading;
  source: EnvironmentTelemetrySource;
}

type NodeSeriesMap = ReadonlyMap<number, readonly EnvironmentHistoryPoint[]>;

const EMPTY_SERIES: readonly EnvironmentHistoryPoint[] = [];
const EMPTY_NODE_MAP: NodeSeriesMap = new Map();

interface EnvironmentTelemetryState {
  history: ReadonlyMap<MeshProtocol, NodeSeriesMap>;
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

function withSeries(
  history: ReadonlyMap<MeshProtocol, NodeSeriesMap>,
  protocol: MeshProtocol,
  nodeId: number,
  series: readonly EnvironmentHistoryPoint[],
): Map<MeshProtocol, NodeSeriesMap> {
  const nodes = new Map(history.get(protocol) ?? EMPTY_NODE_MAP);
  if (!nodes.has(nodeId) && nodes.size >= MAX_NODES_PER_PROTOCOL) {
    const firstKey = nodes.keys().next().value;
    if (firstKey !== undefined) nodes.delete(firstKey);
  }
  nodes.set(nodeId, series);
  const next = new Map(history);
  next.set(protocol, nodes);
  return next;
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
    const cutoff = now - ENVIRONMENT_TELEMETRY_RETENTION_MS;
    const series = existing.filter((p) => p.t >= cutoff);
    series.push({ t: now, reading: clean, source });
    if (series.length > ENVIRONMENT_TELEMETRY_MAX_PER_NODE) {
      series.splice(0, series.length - ENVIRONMENT_TELEMETRY_MAX_PER_NODE);
    }
    set({ history: withSeries(get().history, protocol, nodeId, series) });

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
      const live = get().history;
      const merged = new Map<MeshProtocol, NodeSeriesMap>();
      for (const [protocol, nodes] of loaded) {
        const liveNodes = live.get(protocol);
        for (const [nodeId, series] of nodes) {
          const lastT = series.at(-1)?.t ?? 0;
          for (const p of liveNodes?.get(nodeId) ?? EMPTY_SERIES) {
            if (p.t > lastT) series.push(p);
          }
          if (series.length > ENVIRONMENT_TELEMETRY_MAX_PER_NODE) {
            series.splice(0, series.length - ENVIRONMENT_TELEMETRY_MAX_PER_NODE);
          }
        }
        for (const [nodeId, series] of liveNodes ?? EMPTY_NODE_MAP) {
          if (!nodes.has(nodeId)) nodes.set(nodeId, [...series]);
        }
        merged.set(protocol, nodes);
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
