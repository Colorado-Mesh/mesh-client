import { create } from 'zustand';

import type { IdentityId, MeshProtocol } from '@/renderer/lib/types';

export interface MapTraceRouteRoute {
  nodeIds: number[];
  labels?: string[];
  protocol: MeshProtocol;
  identityId: IdentityId | null;
}

export interface MapTraceRouteState {
  route: MapTraceRouteRoute | null;
  setRoute: (
    nodeIds: number[],
    labels: string[] | undefined,
    scope: { protocol: MeshProtocol; identityId: IdentityId | null },
  ) => void;
  clear: () => void;
}

/** Session-only traceroute overlay selected from Node Detail → Show on map. */
export const useMapTraceRouteStore = create<MapTraceRouteState>()((set) => ({
  route: null,
  setRoute: (nodeIds, labels, scope) => {
    set({
      route: {
        nodeIds,
        labels,
        protocol: scope.protocol,
        identityId: scope.identityId,
      },
    });
  },
  clear: () => {
    set({ route: null });
  },
}));
