import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { CustomMapSourceInfo } from '@/shared/offlineMaps/customMapSources';

interface CustomMapSourcesState {
  /** `null` until the first successful load from the main process. */
  sources: CustomMapSourceInfo[] | null;
  refresh: () => Promise<void>;
  ensureLoaded: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useCustomMapSourcesStore = create<CustomMapSourcesState>((set, get) => ({
  sources: null,
  refresh: async () => {
    try {
      const sources = await window.electronAPI.offlineMaps.custom.list();
      set({ sources });
    } catch (e: unknown) {
      console.warn('[customMapSourcesStore] list failed ' + errLikeToLogString(e));
    }
  },
  ensureLoaded: async () => {
    if (get().sources !== null) return;
    inFlight ??= get()
      .refresh()
      .finally(() => {
        inFlight = null;
      });
    await inFlight;
  },
}));
