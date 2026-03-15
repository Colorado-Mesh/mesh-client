import { create } from 'zustand';

import { haversineDistanceKm } from '../lib/nodeStatus';
import { parseStoredJson } from '../lib/parseStoredJson';
import type { PositionPoint } from '../lib/types';

const SIXTY_MIN_MS = 60 * 60 * 1000;
const MOVEMENT_THRESHOLD_KM = 0.01; // 10 metres — filters GPS jitter

function loadShowPaths(): boolean {
  const o = parseStoredJson<{ showMovementPaths?: boolean }>(
    localStorage.getItem('mesh-client:adminSettings'),
    'positionHistoryStore loadShowPaths',
  );
  return o?.showMovementPaths !== false; // default true
}

interface PositionHistoryState {
  history: Map<number, PositionPoint[]>;
  showPaths: boolean;
  recordPosition(nodeId: number, lat: number, lon: number): void;
  clearHistory(): void;
  setShowPaths(enabled: boolean): void;
}

export const usePositionHistoryStore = create<PositionHistoryState>((set, get) => ({
  history: new Map(),
  showPaths: loadShowPaths(),

  recordPosition(nodeId, lat, lon) {
    const now = Date.now();
    const existing = get().history.get(nodeId) ?? [];
    const pruned = existing.filter((p) => p.t > now - SIXTY_MIN_MS);
    const last = pruned.at(-1);
    if (!last || haversineDistanceKm(last.lat, last.lon, lat, lon) >= MOVEMENT_THRESHOLD_KM) {
      pruned.push({ t: now, lat, lon });
    }
    const newHistory = new Map(get().history);
    newHistory.set(nodeId, pruned);
    set({ history: newHistory });
  },

  clearHistory() {
    set({ history: new Map() });
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
}));
