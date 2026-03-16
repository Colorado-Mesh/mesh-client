import { create } from 'zustand';

import { haversineDistanceKm } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { PositionPoint } from '../lib/types';

const MOVEMENT_THRESHOLD_KM = 0.01; // 10 metres — filters GPS jitter

function loadShowPaths(): boolean {
  const o = parseStoredJson<{ showMovementPaths?: boolean }>(
    localStorage.getItem('mesh-client:adminSettings'),
    'positionHistoryStore loadShowPaths',
  );
  return o?.showMovementPaths !== false; // default true
}

function loadHistoryWindowHours(): number {
  const o = parseStoredJson<{ positionHistoryWindowHours?: number }>(
    localStorage.getItem('mesh-client:adminSettings'),
    'positionHistoryStore loadHistoryWindowHours',
  );
  const v = o?.positionHistoryWindowHours;
  return typeof v === 'number' && v > 0 ? v : 24;
}

interface PositionHistoryState {
  history: Map<number, PositionPoint[]>;
  showPaths: boolean;
  historyWindowHours: number;
  recordPosition(nodeId: number, lat: number, lon: number, source?: string): void;
  clearHistory(): void;
  setShowPaths(enabled: boolean): void;
  setHistoryWindow(hours: number): void;
  loadHistoryFromDb(): Promise<void>;
}

export const usePositionHistoryStore = create<PositionHistoryState>((set, get) => ({
  history: new Map(),
  showPaths: loadShowPaths(),
  historyWindowHours: loadHistoryWindowHours(),

  recordPosition(nodeId, lat, lon, source = 'rf') {
    const now = Date.now();
    const windowMs = get().historyWindowHours * 3600 * 1000;
    const existing = get().history.get(nodeId) ?? [];
    const pruned = existing.filter((p) => p.t > now - windowMs);
    const last = pruned.at(-1);
    if (!last || haversineDistanceKm(last.lat, last.lon, lat, lon) >= MOVEMENT_THRESHOLD_KM) {
      pruned.push({ t: now, lat, lon });
      // Fire-and-forget DB write; never block the position update
      try {
        window.electronAPI.db.savePositionHistory(nodeId, lat, lon, now, source).catch((err) => {
          console.warn('[positionHistory] DB write failed:', err);
        });
      } catch {
        /* electronAPI may not be available in test/storybook contexts */
      }
    }
    const newHistory = new Map(get().history);
    newHistory.set(nodeId, pruned);
    set({ history: newHistory });
  },

  clearHistory() {
    set({ history: new Map() });
    try {
      window.electronAPI.db.clearPositionHistory().catch((err) => {
        console.warn('[positionHistory] clearPositionHistory DB failed:', err);
      });
    } catch {
      /* non-electron context */
    }
  },

  setShowPaths(enabled) {
    try {
      const raw = localStorage.getItem('mesh-client:adminSettings');
      const o =
        parseStoredJson<Record<string, unknown>>(raw, 'positionHistoryStore setShowPaths') ?? {};
      localStorage.setItem(
        'mesh-client:adminSettings',
        JSON.stringify({ ...o, showMovementPaths: enabled }),
      );
    } catch {
      /* ignore */
    }
    set({ showPaths: enabled });
  },

  setHistoryWindow(hours) {
    try {
      const raw = localStorage.getItem('mesh-client:adminSettings');
      const o =
        parseStoredJson<Record<string, unknown>>(raw, 'positionHistoryStore setHistoryWindow') ??
        {};
      localStorage.setItem(
        'mesh-client:adminSettings',
        JSON.stringify({ ...o, positionHistoryWindowHours: hours }),
      );
    } catch {
      /* ignore */
    }
    set({ historyWindowHours: hours });
    // Reload history from DB with the new window
    get().loadHistoryFromDb();
  },

  async loadHistoryFromDb() {
    try {
      const windowMs = get().historyWindowHours * 3600 * 1000;
      const sinceMs = Date.now() - windowMs;
      const rows = (await window.electronAPI.db.getPositionHistory(sinceMs)) as {
        node_id: number;
        latitude: number;
        longitude: number;
        recorded_at: number;
      }[];
      if (!rows || rows.length === 0) return;

      const newHistory = new Map<number, PositionPoint[]>();
      for (const row of rows) {
        const arr = newHistory.get(row.node_id) ?? [];
        const last = arr.at(-1);
        // Apply movement threshold dedup to suppress GPS jitter from old data
        if (
          !last ||
          haversineDistanceKm(last.lat, last.lon, row.latitude, row.longitude) >=
            MOVEMENT_THRESHOLD_KM
        ) {
          arr.push({ t: row.recorded_at, lat: row.latitude, lon: row.longitude });
        }
        newHistory.set(row.node_id, arr);
      }
      set({ history: newHistory });
    } catch (err) {
      console.warn('[positionHistory] loadHistoryFromDb failed:', err);
    }
  },
}));
