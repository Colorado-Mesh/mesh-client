import { create } from 'zustand';

import { MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT } from '@/shared/meshcorePathHistoryLimits';

import type { PathRecord, PathScore, PathSelection } from '../lib/pathHistoryTypes';

const MAX_CONTACTS = 50;

/** DB row shape from `getMeshcorePathHistory` / `getAllMeshcorePathHistory` IPC. */
interface MeshcorePathHistoryWireRow {
  id: number;
  node_id: number;
  path_hash: string;
  hop_count: number;
  path_bytes: string;
  was_flood_discovery: number;
  success_count: number;
  failure_count: number;
  trip_time_ms: number;
  route_weight: number;
  last_success_ts: number | null;
  created_at: number;
  updated_at: number;
}

function pathHistoryWireRowToRecord(row: MeshcorePathHistoryWireRow): PathRecord {
  let pathBytes: number[] = [];
  try {
    pathBytes = JSON.parse(row.path_bytes) as number[];
  } catch {
    // catch-no-log-ok malformed stored path_bytes
  }
  return {
    id: row.id,
    nodeId: row.node_id,
    pathHash: row.path_hash,
    hopCount: row.hop_count,
    pathBytes,
    wasFloodDiscovery: row.was_flood_discovery === 1,
    successCount: row.success_count,
    failureCount: row.failure_count,
    tripTimeMs: row.trip_time_ms,
    routeWeight: row.route_weight,
    lastSuccessTs: row.last_success_ts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Compute a hex path hash from an array of path bytes. */
export function computePathHash(pathBytes: number[]): string {
  // Simple deterministic hex string for dedup key
  return pathBytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Weighted route score. All component inputs are pre-normalized to [0, 1].
 *
 * Weights: reliability 45%, latency 25%, freshness 10%, routeWeight 20%.
 */
export function computeScore(
  record: PathRecord,
  fastestKnownTripMs: number,
  highestKnownWeight: number,
): PathScore {
  const totalAttempts = record.successCount + record.failureCount;
  const reliability = (record.successCount + 1) / (totalAttempts + 2);

  let latency = 0.6; // default when unknown
  if (record.tripTimeMs > 0 && fastestKnownTripMs > 0) {
    latency = Math.min(1, fastestKnownTripMs / record.tripTimeMs);
  }

  const ageInDays = record.lastSuccessTs
    ? (Date.now() - record.lastSuccessTs) / (24 * 60 * 60 * 1000)
    : 30; // treat never-succeeded as stale
  const freshness = 1 / (1 + ageInDays);

  const routeWeight =
    highestKnownWeight > 0 ? Math.min(1, record.routeWeight / highestKnownWeight) : 1;

  const total = reliability * 0.45 + latency * 0.25 + freshness * 0.1 + routeWeight * 0.2;

  return { reliability, latency, freshness, routeWeight, total };
}

interface PathHistoryState {
  /** In-memory records keyed by nodeId. Each contact has a list of known paths. */
  records: Map<number, PathRecord[]>;
  /** LRU order: most recently accessed nodeId is last. Oldest is first. */
  lruOrder: number[];

  recordPathUpdated(
    nodeId: number,
    pathBytes: number[],
    hopCount: number,
    wasFloodDiscovery: boolean,
    routeWeight?: number,
  ): void;
  recordOutcome(nodeId: number, pathHash: string, success: boolean, tripTimeMs?: number): void;
  selectBestPath(nodeId: number): PathSelection | null;
  /** Load from SQLite when no in-memory best path (e.g. LRU evicted); then re-select. */
  ensureBestPathLoaded(nodeId: number): Promise<PathSelection | null>;
  loadForNode(nodeId: number): Promise<void>;
  /** Hydrate in-memory path history from SQLite for all nodes (call at app start). */
  loadAllFromDb(): Promise<void>;
  clearForNode(nodeId: number): void;
  clearAll(): void;
}

function evictLRU(records: Map<number, PathRecord[]>, lruOrder: number[]): void {
  while (lruOrder.length > MAX_CONTACTS) {
    const evictId = lruOrder.shift();
    if (evictId !== undefined) {
      records.delete(evictId);
    }
  }
}

function touchLRU(lruOrder: number[], nodeId: number): number[] {
  const updated = lruOrder.filter((id) => id !== nodeId);
  updated.push(nodeId);
  return updated;
}

/**
 * Returns the highest-weighted path record for each contact in the store.
 * Only includes entries where routeWeight is finite and > 0.
 */
export function getWeightedPaths(
  records: Map<number, PathRecord[]>,
): { nodeId: number; routeWeight: number; pathBytes: number[] }[] {
  const result: { nodeId: number; routeWeight: number; pathBytes: number[] }[] = [];
  for (const [nodeId, pathList] of records) {
    let best: PathRecord | null = null;
    for (const r of pathList) {
      if (!Number.isFinite(r.routeWeight)) continue;
      if (r.routeWeight <= 0) continue;
      if (!best || r.routeWeight > best.routeWeight) best = r;
    }
    if (best) {
      result.push({ nodeId, routeWeight: best.routeWeight, pathBytes: best.pathBytes });
    }
  }
  return result;
}

export const usePathHistoryStore = create<PathHistoryState>((set, get) => ({
  records: new Map(),
  lruOrder: [],

  recordPathUpdated(nodeId, pathBytes, hopCount, wasFloodDiscovery, routeWeight = 1.0) {
    const pathHash = computePathHash(pathBytes);
    const now = Date.now();

    const state = get();
    const newRecords = new Map(state.records);
    const existing = newRecords.get(nodeId) ?? [];
    const idx = existing.findIndex((r) => r.pathHash === pathHash);

    let updated: PathRecord[];
    if (idx >= 0) {
      // Update existing record preserving outcome counts
      const prev = existing[idx];
      updated = [
        ...existing.slice(0, idx),
        {
          ...prev,
          hopCount,
          wasFloodDiscovery,
          routeWeight,
          updatedAt: now,
        },
        ...existing.slice(idx + 1),
      ];
    } else {
      const newRecord: PathRecord = {
        nodeId,
        pathHash,
        hopCount,
        pathBytes,
        wasFloodDiscovery,
        successCount: 0,
        failureCount: 0,
        tripTimeMs: 0,
        routeWeight,
        lastSuccessTs: null,
        createdAt: now,
        updatedAt: now,
      };
      updated = [...existing, newRecord];
    }
    newRecords.set(nodeId, updated);
    const newLru = touchLRU(state.lruOrder, nodeId);
    evictLRU(newRecords, newLru);

    set({ records: newRecords, lruOrder: newLru });

    // Fire-and-forget DB persist
    try {
      window.electronAPI.db
        .upsertMeshcorePathHistory(
          nodeId,
          pathHash,
          hopCount,
          pathBytes,
          wasFloodDiscovery,
          routeWeight,
        )
        .catch((err: unknown) => {
          console.warn('[pathHistory] upsertMeshcorePathHistory failed:', err);
        });
    } catch {
      // catch-no-log-ok electronAPI unavailable in tests
    }
  },

  recordOutcome(nodeId, pathHash, success, tripTimeMs) {
    const state = get();
    const existing = state.records.get(nodeId);
    if (!existing) return;

    const idx = existing.findIndex((r) => r.pathHash === pathHash);
    if (idx < 0) return;

    const prev = existing[idx];
    const now = Date.now();
    let updated: PathRecord;
    if (success) {
      updated = {
        ...prev,
        successCount: prev.successCount + 1,
        tripTimeMs:
          tripTimeMs && tripTimeMs > 0 && (prev.tripTimeMs === 0 || tripTimeMs < prev.tripTimeMs)
            ? tripTimeMs
            : prev.tripTimeMs,
        lastSuccessTs: now,
        updatedAt: now,
      };
    } else {
      updated = {
        ...prev,
        failureCount: prev.failureCount + 1,
        updatedAt: now,
      };
    }

    const newList = [...existing.slice(0, idx), updated, ...existing.slice(idx + 1)];
    const newRecords = new Map(state.records);
    newRecords.set(nodeId, newList);
    set({ records: newRecords });

    // Fire-and-forget DB persist
    try {
      window.electronAPI.db
        .recordMeshcorePathOutcome(nodeId, pathHash, success, tripTimeMs)
        .catch((err: unknown) => {
          console.warn('[pathHistory] recordMeshcorePathOutcome failed:', err);
        });
    } catch {
      // catch-no-log-ok electronAPI unavailable in tests
    }
  },

  selectBestPath(nodeId) {
    const records = get().records.get(nodeId);
    if (!records || records.length === 0) return null;

    const positiveTripMs = records.filter((r) => r.tripTimeMs > 0).map((r) => r.tripTimeMs);
    const fastestKnownTripMs = positiveTripMs.length > 0 ? Math.min(...positiveTripMs) : 0;
    const highestKnownWeight = Math.max(...records.map((r) => r.routeWeight), 0);

    let best: PathRecord | null = null;
    let bestScore = -1;
    for (const r of records) {
      const { total } = computeScore(r, fastestKnownTripMs, highestKnownWeight);
      if (total > bestScore) {
        bestScore = total;
        best = r;
      }
    }

    if (!best) return null;
    return {
      pathBytes: best.pathBytes,
      hopCount: best.hopCount,
      pathHash: best.pathHash,
      useFlood: best.wasFloodDiscovery && best.successCount === 0,
    };
  },

  async ensureBestPathLoaded(nodeId) {
    const existing = get().selectBestPath(nodeId);
    if (existing != null) return existing;
    await get().loadForNode(nodeId);
    const selected = get().selectBestPath(nodeId);
    return selected;
  },

  async loadForNode(nodeId) {
    try {
      const rows = await window.electronAPI.db.getMeshcorePathHistory(nodeId);
      if (!rows || rows.length === 0) return;

      const parsed: PathRecord[] = rows.map((row) => pathHistoryWireRowToRecord(row));

      const state = get();
      const newRecords = new Map(state.records);
      newRecords.set(nodeId, parsed);
      const newLru = touchLRU(state.lruOrder, nodeId);
      evictLRU(newRecords, newLru);
      set({ records: newRecords, lruOrder: newLru });
    } catch (err) {
      console.warn('[pathHistory] loadForNode failed:', err);
    }
  },

  async loadAllFromDb() {
    try {
      const api = window.electronAPI?.db?.getAllMeshcorePathHistory;
      if (typeof api !== 'function') return;
      const rows = (await api()) as MeshcorePathHistoryWireRow[];
      if (!rows || rows.length === 0) return;
      if (rows.length >= MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT) {
        console.warn(
          '[pathHistory] loadAllFromDb: loaded row count hit global DB limit; some history may be missing',
          MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT,
        );
      }

      const byNode = new Map<number, PathRecord[]>();
      const latestTs = new Map<number, number>();
      for (const row of rows) {
        const rec = pathHistoryWireRowToRecord(row);
        const list = byNode.get(row.node_id) ?? [];
        list.push(rec);
        byNode.set(row.node_id, list);
        const prev = latestTs.get(row.node_id) ?? 0;
        if (row.updated_at > prev) latestTs.set(row.node_id, row.updated_at);
      }

      const nodeIdsByRecency = [...byNode.keys()].sort(
        (a, b) => (latestTs.get(b) ?? 0) - (latestTs.get(a) ?? 0),
      );
      const lruOrder = nodeIdsByRecency.slice(0, MAX_CONTACTS);
      const records = new Map<number, PathRecord[]>();
      for (const id of lruOrder) {
        const list = byNode.get(id);
        if (list) records.set(id, list);
      }
      set({ records, lruOrder });
    } catch (err) {
      console.warn('[pathHistory] loadAllFromDb failed:', err);
    }
  },

  clearForNode(nodeId) {
    const newRecords = new Map(get().records);
    newRecords.delete(nodeId);
    const newLru = get().lruOrder.filter((id) => id !== nodeId);
    set({ records: newRecords, lruOrder: newLru });
    try {
      window.electronAPI.db.deleteMeshcorePathHistoryForNode(nodeId).catch((err: unknown) => {
        console.warn('[pathHistory] deleteMeshcorePathHistoryForNode failed:', err);
      });
    } catch {
      // catch-no-log-ok electronAPI unavailable in tests
    }
  },

  clearAll() {
    set({ records: new Map(), lruOrder: [] });
    try {
      window.electronAPI.db.deleteAllMeshcorePathHistory().catch((err: unknown) => {
        console.warn('[pathHistory] deleteAllMeshcorePathHistory failed:', err);
      });
    } catch {
      // catch-no-log-ok electronAPI unavailable in tests
    }
  },
}));
