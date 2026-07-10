import { create } from 'zustand';

import type { ReticulumRmapDiscoveredWireRow } from '@/shared/reticulum-types';

interface ReticulumDiscoveryMapState {
  discovered: ReticulumRmapDiscoveredWireRow[];
  loading: boolean;
  lastRefreshAt: number | null;
  setDiscovered: (rows: ReticulumRmapDiscoveredWireRow[]) => void;
  setLoading: (loading: boolean) => void;
  clear: () => void;
}

export const useReticulumDiscoveryMapStore = create<ReticulumDiscoveryMapState>((set) => ({
  discovered: [],
  loading: false,
  lastRefreshAt: null,
  setDiscovered: (rows) => {
    set({
      discovered: rows,
      loading: false,
      lastRefreshAt: Date.now(),
    });
  },
  setLoading: (loading) => {
    set({ loading });
  },
  clear: () => {
    set({
      discovered: [],
      loading: false,
      lastRefreshAt: null,
    });
  },
}));

export function mergeRmapDiscoveryRows(
  existing: ReticulumRmapDiscoveredWireRow[],
  incoming: ReticulumRmapDiscoveredWireRow[],
): ReticulumRmapDiscoveredWireRow[] {
  const byHash = new Map<string, ReticulumRmapDiscoveredWireRow>();
  for (const row of existing) {
    byHash.set(row.discovery_hash, row);
  }
  for (const row of incoming) {
    byHash.set(row.discovery_hash, row);
  }
  return [...byHash.values()].sort((a, b) => b.last_heard - a.last_heard);
}
