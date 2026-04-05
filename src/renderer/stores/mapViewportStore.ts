import { create } from 'zustand';

export interface MapViewport {
  center: [number, number];
  zoom: number;
}

interface MapViewportState {
  viewport: MapViewport | null;
  setViewport: (viewport: MapViewport) => void;
}

export const useMapViewportStore = create<MapViewportState>((set) => ({
  viewport: null,
  setViewport: (viewport) => {
    set({ viewport });
  },
}));
