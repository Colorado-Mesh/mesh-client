import { create } from 'zustand';

export interface MapTraceRouteState {
  route: { nodeIds: number[]; labels?: string[] } | null;
  setRoute: (nodeIds: number[], labels?: string[]) => void;
  clear: () => void;
}

/** Session-only traceroute overlay selected from Node Detail → Show on map. */
export const useMapTraceRouteStore = create<MapTraceRouteState>()((set) => ({
  route: null,
  setRoute: (nodeIds, labels) => {
    set({ route: { nodeIds, labels } });
  },
  clear: () => {
    set({ route: null });
  },
}));
