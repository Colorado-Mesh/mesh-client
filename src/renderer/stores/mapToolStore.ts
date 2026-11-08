import { create } from 'zustand';

interface MapToolState {
  measureActive: boolean;
  setMeasureActive: (active: boolean) => void;
}

/** Shared map tool flags (measure, etc.) for click-gating overlays. */
export const useMapToolStore = create<MapToolState>((set) => ({
  measureActive: false,
  setMeasureActive: (measureActive) => {
    set({ measureActive });
  },
}));
