import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

export interface PropagationNodeRow {
  id: string;
  name: string;
  hops?: number | null;
  enabled: boolean;
  status: string;
  preferred?: boolean;
}

interface PropagationSyncState {
  active: boolean;
  progress: number;
  message?: string | null;
}

interface ReticulumPropagationStoreState {
  nodes: PropagationNodeRow[];
  preferredId: string | null;
  autoSyncIntervalSec: number;
  sync: PropagationSyncState;
  replaceNodes: (nodes: PropagationNodeRow[]) => void;
  setPreferredId: (id: string | null) => void;
  setAutoSyncIntervalSec: (sec: number) => void;
  setSyncState: (patch: Partial<PropagationSyncState>) => void;
  refreshFromSidecar: () => Promise<void>;
  setPreferredOnSidecar: (id: string) => Promise<boolean>;
  startSync: (id?: string) => Promise<boolean>;
  cancelSync: () => Promise<boolean>;
}

export const useReticulumPropagationStore = create<ReticulumPropagationStoreState>((set, get) => ({
  nodes: [],
  preferredId: null,
  autoSyncIntervalSec: 0,
  sync: { active: false, progress: 0, message: null },

  replaceNodes: (nodes) => {
    set({ nodes });
  },

  setPreferredId: (id) => {
    set({ preferredId: id });
  },

  setAutoSyncIntervalSec: (sec) => {
    set({ autoSyncIntervalSec: sec });
  },

  setSyncState: (patch) => {
    set((s) => ({ sync: { ...s.sync, ...patch } }));
  },

  refreshFromSidecar: async () => {
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/propagation')) as {
        propagation?: PropagationNodeRow[];
        preferred_id?: string | null;
        auto_sync_interval_sec?: number;
      };
      const nodes = body.propagation ?? [];
      set({
        nodes,
        preferredId: body.preferred_id ?? null,
        autoSyncIntervalSec: body.auto_sync_interval_sec ?? 0,
      });
    } catch (e) {
      console.warn('[reticulumPropagationStore] refresh ' + errLikeToLogString(e));
    }
  },

  setPreferredOnSidecar: async (id) => {
    try {
      const res = (await window.electronAPI.reticulum.proxyPost(
        `/api/v1/propagation/${id}/preferred`,
        {},
      )) as { ok?: boolean };
      if (res.ok) {
        set({ preferredId: id });
        return true;
      }
    } catch (e) {
      console.warn('[reticulumPropagationStore] preferred ' + errLikeToLogString(e));
    }
    return false;
  },

  startSync: async (id) => {
    const propId = id ?? get().preferredId;
    if (!propId) return false;
    set({ sync: { active: true, progress: 0, message: null } });
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/sync', {
        propagation_id: propId,
      })) as { ok?: boolean };
      if (!res.ok) {
        set({ sync: { active: false, progress: 0, message: null } });
      }
      return Boolean(res.ok);
    } catch (e) {
      console.warn('[reticulumPropagationStore] sync ' + errLikeToLogString(e));
      set({ sync: { active: false, progress: 0, message: null } });
      return false;
    }
  },

  cancelSync: async () => {
    try {
      await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/sync/cancel', {});
      set({ sync: { active: false, progress: 0, message: null } });
      return true;
    } catch (e) {
      console.warn('[reticulumPropagationStore] cancel ' + errLikeToLogString(e));
      return false;
    }
  },
}));
