import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { CustomMapSourceInfo } from '@/shared/offlineMaps/customMapSources';

interface CustomMapSourcesState {
  /** `null` until the first successful load from the main process. */
  sources: CustomMapSourceInfo[] | null;
  /** True after a list attempt failed and `sources` is still null. */
  loadError: boolean;
  refresh: () => Promise<void>;
  ensureLoaded: () => Promise<void>;
}

let inFlight: Promise<void> | null = null;

export const useCustomMapSourcesStore = create<CustomMapSourcesState>((set, get) => ({
  sources: null,
  loadError: false,
  refresh: async () => {
    try {
      const sources = await window.electronAPI.offlineMaps.custom.list();
      set({ sources, loadError: false });
    } catch (e: unknown) {
      console.warn('[customMapSourcesStore] list failed ' + errLikeToLogString(e));
      set({ loadError: true });
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
