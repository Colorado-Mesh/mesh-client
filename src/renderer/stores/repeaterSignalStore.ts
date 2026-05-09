import { create } from 'zustand';

interface SignalPoint {
  ts: number;
  snr: number;
}

interface RepeaterSignalState {
  history: Map<number, SignalPoint[]>;
  recordSignal: (nodeId: number, snr: number, ts?: number) => void;
  getHistory: (nodeId: number) => SignalPoint[];
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_POINTS = 288;
const MAX_NODES = 500;

export const useRepeaterSignalStore = create<RepeaterSignalState>((set, get) => ({
  history: new Map(),
  recordSignal: (nodeId, snr, ts = Date.now()) => {
    set((s) => {
      const prev = s.history.get(nodeId) ?? [];
      const pruned = prev.filter((p) => ts - p.ts < WINDOW_MS);
      const next = [...pruned, { ts, snr }].slice(-MAX_POINTS);
      const m = new Map(s.history);
      if (!m.has(nodeId) && m.size >= MAX_NODES) {
        const firstKey = m.keys().next().value;
        if (firstKey !== undefined) m.delete(firstKey);
      }
      m.set(nodeId, next);
      return { history: m };
    });
  },
  getHistory: (nodeId) => get().history.get(nodeId) ?? [],
}));
