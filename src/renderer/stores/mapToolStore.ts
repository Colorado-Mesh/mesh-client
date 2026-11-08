import { create } from 'zustand';

import type { ElevationFrequencyMhz } from '@/shared/elevation/types';

export interface MapProfileEndpoint {
  lat: number;
  lon: number;
  /** Node id when snapped from a marker; undefined for free map clicks. */
  nodeId?: number;
  /** Meters above ground (antenna); defaults applied in the control. */
  antennaHeightM?: number;
  /** Ground altitude from node telemetry when known. */
  groundAltitudeM?: number;
}

interface MapToolState {
  measureActive: boolean;
  setMeasureActive: (active: boolean) => void;
  profileActive: boolean;
  setProfileActive: (active: boolean) => void;
  /** 0–2 endpoints for the active terrain profile tool. */
  profileEndpoints: MapProfileEndpoint[];
  setProfileEndpoints: (endpoints: MapProfileEndpoint[]) => void;
  addProfileEndpoint: (endpoint: MapProfileEndpoint) => void;
  clearProfileEndpoints: () => void;
  profileFrequencyMhz: ElevationFrequencyMhz;
  setProfileFrequencyMhz: (mhz: ElevationFrequencyMhz) => void;
}

/** Shared map tool flags (measure, terrain profile) for click-gating overlays. */
export const useMapToolStore = create<MapToolState>((set) => ({
  measureActive: false,
  setMeasureActive: (measureActive) => {
    set({ measureActive });
  },
  profileActive: false,
  setProfileActive: (profileActive) => {
    if (profileActive) {
      set({ profileActive, measureActive: false });
    } else {
      set({ profileActive, profileEndpoints: [] });
    }
  },
  profileEndpoints: [],
  setProfileEndpoints: (profileEndpoints) => {
    set({ profileEndpoints: profileEndpoints.slice(0, 2) });
  },
  addProfileEndpoint: (endpoint) => {
    set((state) => {
      if (!state.profileActive) return state;
      const next = [...state.profileEndpoints, endpoint].slice(-2);
      return { profileEndpoints: next };
    });
  },
  clearProfileEndpoints: () => {
    set({ profileEndpoints: [] });
  },
  profileFrequencyMhz: 915,
  setProfileFrequencyMhz: (profileFrequencyMhz) => {
    set({ profileFrequencyMhz });
  },
}));
