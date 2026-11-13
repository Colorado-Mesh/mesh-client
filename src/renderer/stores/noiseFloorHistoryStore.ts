import { create } from 'zustand';

import {
  appendNoiseFloorSample,
  NOISE_FLOOR_HISTORY_MAX_NODES,
  type NoiseFloorSample,
} from '../lib/meshcore/noiseFloorHistory';

const EMPTY_SERIES: readonly NoiseFloorSample[] = [];

interface NoiseFloorHistoryState {
  history: Map<number, readonly NoiseFloorSample[]>;
  /**
   * Record a noise-floor reading for one node. Invalid / deduped samples are ignored.
   * Returns true when the series changed.
   */
  recordSample: (nodeId: number, noiseFloor: number, ts?: number) => boolean;
  clearNode: (nodeId: number) => void;
  clearAll: () => void;
}

export function selectNoiseFloorSeries(
  state: Pick<NoiseFloorHistoryState, 'history'>,
  nodeId: number,
): readonly NoiseFloorSample[] {
  return state.history.get(nodeId) ?? EMPTY_SERIES;
}

export const useNoiseFloorHistoryStore = create<NoiseFloorHistoryState>((set, get) => ({
  history: new Map(),

  recordSample(nodeId, noiseFloor, ts = Date.now()) {
    if (!Number.isInteger(nodeId) || nodeId <= 0) return false;
    const existing = get().history.get(nodeId) ?? EMPTY_SERIES;
    const nextSeries = appendNoiseFloorSample(existing, { t: ts, noiseFloor }, { nowMs: ts });
    if (!nextSeries) return false;
    set((s) => {
      const m = new Map(s.history);
      if (!m.has(nodeId) && m.size >= NOISE_FLOOR_HISTORY_MAX_NODES) {
        const firstKey = m.keys().next().value;
        if (firstKey !== undefined) m.delete(firstKey);
      }
      m.set(nodeId, nextSeries);
      return { history: m };
    });
    return true;
  },

  clearNode(nodeId) {
    set((s) => {
      if (!s.history.has(nodeId)) return s;
      const m = new Map(s.history);
      m.delete(nodeId);
      return { history: m };
    });
  },

  clearAll() {
    set({ history: new Map() });
  },
}));
