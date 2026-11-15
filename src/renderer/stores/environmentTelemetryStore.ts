import { create } from 'zustand';

import {
  ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS,
  ENVIRONMENT_TELEMETRY_LEGACY_IDENTITY_ID,
  ENVIRONMENT_TELEMETRY_MAX_NODES,
  ENVIRONMENT_TELEMETRY_MAX_PER_NODE,
  ENVIRONMENT_TELEMETRY_PRUNE_EVERY_N_INSERTS,
  ENVIRONMENT_TELEMETRY_PRUNE_INTERVAL_MS,
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
import type { IdentityId } from '../lib/types';

export interface EnvironmentHistoryPoint {
  t: number;
  reading: EnvironmentReading;
  source: EnvironmentTelemetrySource;
}

type NodeSeriesMap = ReadonlyMap<number, readonly EnvironmentHistoryPoint[]>;
type MutableNodeSeriesMap = Map<number, readonly EnvironmentHistoryPoint[]>;

const EMPTY_SERIES: readonly EnvironmentHistoryPoint[] = [];
const EMPTY_NODE_MAP: NodeSeriesMap = new Map();

/** protocol → identityId → nodeId → series */
type HistoryMap = Map<MeshProtocol, Map<IdentityId, MutableNodeSeriesMap>>;

interface EnvironmentTelemetryState {
  history: HistoryMap;
  /**
   * Store a reading for one node under an identity. Identical readings inside the dedup window
   * are dropped (same packet heard over RF and MQTT). Returns true when the reading was kept.
   */
  recordReading(
    protocol: MeshProtocol,
    identityId: IdentityId,
    nodeId: number,
    reading: EnvironmentReading,
    source: EnvironmentTelemetrySource,
  ): boolean;
  clearHistory(): Promise<void>;
  loadFromDb(): Promise<void>;
  /** Attribute legacy (`identity_id=''`) rows to this identity for `protocol` (one-time). */
  claimLegacyIdentity(protocol: MeshProtocol, identityId: IdentityId): Promise<void>;
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
 * Store `series` for one node under an identity. Other identities/nodes keep their series arrays.
 */
function installSeries(
  history: HistoryMap,
  protocol: MeshProtocol,
  identityId: IdentityId,
  nodeId: number,
  series: readonly EnvironmentHistoryPoint[],
): HistoryMap {
  const byIdentity = history.get(protocol) ?? new Map<IdentityId, MutableNodeSeriesMap>();
  const prior = byIdentity.get(identityId);
  const nodes: MutableNodeSeriesMap = prior
    ? new Map<number, readonly EnvironmentHistoryPoint[]>(prior)
    : new Map<number, readonly EnvironmentHistoryPoint[]>();
  if (!nodes.has(nodeId) && nodes.size >= ENVIRONMENT_TELEMETRY_MAX_NODES) {
    const firstKey = nodes.keys().next().value;
    if (firstKey !== undefined) nodes.delete(firstKey);
  }
  nodes.set(nodeId, series);
  const nextIdentities = new Map(byIdentity);
  nextIdentities.set(identityId, nodes);
  const next = new Map(history);
  next.set(protocol, nextIdentities);
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

let insertsSincePrune = 0;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped on clear so in-flight `loadFromDb` results are discarded. */
let historyGeneration = 0;

async function runPeriodicPrune(): Promise<void> {
  const prune = window.electronAPI?.db?.pruneEnvironmentTelemetry;
  if (typeof prune !== 'function') return;
  try {
    const changes = await prune();
    if (typeof changes === 'number' && changes > 0) {
      console.debug(`[environmentTelemetry] periodic prune removed ${changes} rows`);
    }
  } catch (err: unknown) {
    console.warn('[environmentTelemetry] periodic prune failed: ' + errLikeToLogString(err));
  }
}

function noteSuccessfulInsert(): void {
  insertsSincePrune += 1;
  if (insertsSincePrune >= ENVIRONMENT_TELEMETRY_PRUNE_EVERY_N_INSERTS) {
    insertsSincePrune = 0;
    void runPeriodicPrune();
  }
  if (pruneTimer == null && typeof setInterval === 'function') {
    pruneTimer = setInterval(() => {
      void runPeriodicPrune();
    }, ENVIRONMENT_TELEMETRY_PRUNE_INTERVAL_MS);
    // Allow the process to exit in tests/Node without waiting for the timer.
    if (typeof pruneTimer === 'object' && pruneTimer !== null && 'unref' in pruneTimer) {
      pruneTimer.unref?.();
    }
  }
}

export const useEnvironmentTelemetryStore = create<EnvironmentTelemetryState>((set, get) => ({
  history: new Map(),

  recordReading(protocol, identityId, nodeId, reading, source) {
    if (!identityId || !Number.isInteger(nodeId) || nodeId <= 0) return false;
    const clean = sanitizeEnvironmentReading(reading);
    if (!clean) return false;
    const now = Date.now();
    const existing = get().history.get(protocol)?.get(identityId)?.get(nodeId) ?? EMPTY_SERIES;
    const last = existing.at(-1);
    if (
      last &&
      now - last.t < ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS &&
      environmentReadingsEqual(last.reading, clean)
    ) {
      return false;
    }
    const series = appendBoundedSeries(existing, { t: now, reading: clean, source }, now);
    set({ history: installSeries(get().history, protocol, identityId, nodeId, series) });

    // Fire-and-forget: persistence must never block or drop the live reading.
    const save = window.electronAPI?.db?.saveEnvironmentTelemetry;
    if (typeof save === 'function') {
      save(protocol, identityId, nodeId, now, clean, source)
        .then(() => {
          noteSuccessfulInsert();
        })
        .catch((err: unknown) => {
          console.warn('[environmentTelemetry] DB write failed: ' + errLikeToLogString(err));
        });
    }
    return true;
  },

  async clearHistory() {
    historyGeneration += 1;
    set({ history: new Map() });
    const clear = window.electronAPI?.db?.clearEnvironmentTelemetry;
    if (typeof clear !== 'function') return;
    try {
      await clear();
    } catch (err: unknown) {
      console.warn('[environmentTelemetry] clear DB failed: ' + errLikeToLogString(err));
      throw err;
    }
  },

  async claimLegacyIdentity(protocol, identityId) {
    if (!identityId) return;
    const claim = window.electronAPI?.db?.claimLegacyEnvironmentTelemetryIdentity;
    if (typeof claim !== 'function') return;
    try {
      await claim(protocol, identityId);
    } catch (err: unknown) {
      console.warn('[environmentTelemetry] claimLegacyIdentity failed: ' + errLikeToLogString(err));
      return;
    }
    set((state) => {
      const byIdentity = state.history.get(protocol);
      if (!byIdentity) return state;
      const legacy = byIdentity.get(ENVIRONMENT_TELEMETRY_LEGACY_IDENTITY_ID);
      if (!legacy || legacy.size === 0) return state;
      const claimant = byIdentity.get(identityId);
      const merged = new Map<number, EnvironmentHistoryPoint[]>();
      for (const [nodeId, series] of claimant ?? []) {
        merged.set(nodeId, [...series]);
      }
      for (const [nodeId, series] of legacy) {
        const existing = merged.get(nodeId) ?? [];
        const combined = [...existing, ...series].sort((a, b) => a.t - b.t || 0);
        merged.set(nodeId, combined);
      }
      const nextByIdentity = new Map(byIdentity);
      nextByIdentity.delete(ENVIRONMENT_TELEMETRY_LEGACY_IDENTITY_ID);
      nextByIdentity.set(identityId, capLoadedNodes(merged));
      const nextHistory = new Map(state.history);
      nextHistory.set(protocol, nextByIdentity);
      return { history: nextHistory };
    });
  },

  async loadFromDb() {
    try {
      const generation = historyGeneration;
      const sinceMs = Date.now() - ENVIRONMENT_TELEMETRY_RETENTION_MS;
      const rows = await window.electronAPI.db.getEnvironmentTelemetry(sinceMs);
      if (generation !== historyGeneration) return;
      if (rows.length === 0) return;
      const loaded = new Map<
        MeshProtocol,
        Map<IdentityId, Map<number, EnvironmentHistoryPoint[]>>
      >();
      for (const row of rows) {
        if (!isMeshProtocol(row.protocol)) continue;
        const reading = environmentReadingFromRow(row);
        if (
          Object.keys(reading).length === 0 &&
          !reading.adcVoltages &&
          !reading.oneWireTemperatures
        )
          continue;
        const identityId =
          typeof row.identity_id === 'string' && row.identity_id.length > 0
            ? row.identity_id
            : ENVIRONMENT_TELEMETRY_LEGACY_IDENTITY_ID;
        let byIdentity = loaded.get(row.protocol);
        if (!byIdentity) {
          byIdentity = new Map();
          loaded.set(row.protocol, byIdentity);
        }
        let nodes = byIdentity.get(identityId);
        if (!nodes) {
          nodes = new Map();
          byIdentity.set(identityId, nodes);
        }
        const series = nodes.get(row.node_id) ?? [];
        series.push({
          t: row.recorded_at,
          reading,
          source:
            row.source === 'mqtt' || row.source === 'rpc' || row.source === 'push'
              ? row.source
              : 'rf',
        });
        nodes.set(row.node_id, series);
      }
      // Readings recorded while the DB load was in flight are newer than any row; keep them.
      const live = get().history;
      const merged: HistoryMap = new Map();
      for (const [protocol, byIdentity] of loaded) {
        const liveByIdentity = live.get(protocol);
        const nextByIdentity = new Map<IdentityId, MutableNodeSeriesMap>();
        for (const [identityId, nodes] of byIdentity) {
          const liveNodes = liveByIdentity?.get(identityId);
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
          nextByIdentity.set(identityId, capLoadedNodes(nodes));
        }
        const emptyIdentityNodes = new Map<IdentityId, MutableNodeSeriesMap>();
        for (const [id, nodes] of liveByIdentity ?? emptyIdentityNodes) {
          if (!nextByIdentity.has(id)) nextByIdentity.set(id, nodes);
        }
        merged.set(protocol, nextByIdentity);
      }
      for (const [protocol, byIdentity] of live) {
        if (!merged.has(protocol)) merged.set(protocol, byIdentity);
      }
      if (generation !== historyGeneration) return;
      set({ history: merged });
    } catch (err) {
      console.warn('[environmentTelemetry] loadFromDb failed: ' + errLikeToLogString(err));
    }
  },
}));

/** Stable per-identity node → series map (module-level empty constant when none). */
export function selectEnvironmentNodes(
  state: Pick<EnvironmentTelemetryState, 'history'>,
  protocol: MeshProtocol,
  identityId: IdentityId | null | undefined,
): NodeSeriesMap {
  if (!identityId) return EMPTY_NODE_MAP;
  const byIdentity = state.history.get(protocol);
  if (!byIdentity) return EMPTY_NODE_MAP;
  return (
    byIdentity.get(identityId) ??
    byIdentity.get(ENVIRONMENT_TELEMETRY_LEGACY_IDENTITY_ID) ??
    EMPTY_NODE_MAP
  );
}

/** Stable series for one node (module-level empty constant when none). */
export function selectEnvironmentSeries(
  state: Pick<EnvironmentTelemetryState, 'history'>,
  protocol: MeshProtocol,
  identityId: IdentityId | null | undefined,
  nodeId: number,
): readonly EnvironmentHistoryPoint[] {
  return selectEnvironmentNodes(state, protocol, identityId).get(nodeId) ?? EMPTY_SERIES;
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
    out.adcVoltages ??= r.adcVoltages;
    out.oneWireTemperatures ??= r.oneWireTemperatures;
  }
  return out;
}

/** Convenience for non-React callers (runtimes, side-effect modules). */
export function recordEnvironmentReading(
  protocol: MeshProtocol,
  identityId: IdentityId,
  nodeId: number,
  reading: EnvironmentReading,
  source: EnvironmentTelemetrySource,
): boolean {
  return useEnvironmentTelemetryStore
    .getState()
    .recordReading(protocol, identityId, nodeId, reading, source);
}
