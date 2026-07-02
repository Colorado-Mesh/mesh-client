import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  clearPropagationSyncStallWatchdog,
  schedulePropagationSyncStallWatchdog,
} from '@/renderer/lib/reticulum/reticulumPropagationSync';
import {
  isReticulumSidecarExpectedProxyError,
  isReticulumSidecarRunning,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC } from '@/shared/reticulumPropagationAutoSync';

export interface PropagationNodeRow {
  id: string;
  name: string;
  hops?: number | null;
  enabled: boolean;
  status: string;
  preferred?: boolean;
  destination_hash?: string | null;
  message_count?: number;
  storage_bytes?: number;
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
  lastSyncError: string | null;
  lastRefreshedAt: number | null;
  lastPropagationSyncAt: number | null;
  replaceNodes: (nodes: PropagationNodeRow[]) => void;
  setPreferredId: (id: string | null) => void;
  setSyncState: (patch: Partial<PropagationSyncState>) => void;
  setLastSyncError: (message: string | null) => void;
  setLastPropagationSyncAt: (atMs: number | null) => void;
  refreshFromSidecar: () => Promise<void>;
  setPreferredOnSidecar: (id: string) => Promise<boolean>;
  setAutoSyncIntervalOnSidecar: (sec: number) => Promise<boolean>;
  startSync: (id?: string) => Promise<boolean>;
  cancelSync: () => Promise<boolean>;
  addPropagationNode: (destinationHash: string, name?: string) => Promise<boolean>;
}

export const useReticulumPropagationStore = create<ReticulumPropagationStoreState>((set, get) => ({
  nodes: [],
  preferredId: null,
  autoSyncIntervalSec: RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
  sync: { active: false, progress: 0, message: null },
  lastSyncError: null,
  lastRefreshedAt: null,
  lastPropagationSyncAt: null,

  replaceNodes: (nodes) => {
    set({ nodes });
  },

  setPreferredId: (id) => {
    set({ preferredId: id });
  },

  setSyncState: (patch) => {
    set((s) => ({ sync: { ...s.sync, ...patch } }));
  },

  setLastSyncError: (message) => {
    set({ lastSyncError: message });
  },

  setLastPropagationSyncAt: (atMs) => {
    set({ lastPropagationSyncAt: atMs });
  },

  refreshFromSidecar: async () => {
    const sidecarRunning = await isReticulumSidecarRunning();
    if (!sidecarRunning) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/propagation')) as {
        propagation?: PropagationNodeRow[];
        preferred_id?: string | null;
        auto_sync_interval_sec?: number;
        last_propagation_sync_at?: number | null;
      };
      const nodes = body.propagation ?? [];
      set({
        nodes,
        preferredId: body.preferred_id ?? null,
        autoSyncIntervalSec:
          body.auto_sync_interval_sec ?? RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
        lastRefreshedAt: Date.now(),
        lastPropagationSyncAt:
          typeof body.last_propagation_sync_at === 'number' && body.last_propagation_sync_at > 0
            ? body.last_propagation_sync_at * 1000
            : get().lastPropagationSyncAt,
      });
    } catch (e) {
      if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[reticulumPropagationStore] refresh ' + errLikeToLogString(e));
      }
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

  setAutoSyncIntervalOnSidecar: async (sec) => {
    try {
      const res = (await window.electronAPI.reticulum.proxyPost(
        '/api/v1/propagation/auto-sync-interval',
        { interval_sec: sec },
      )) as { ok?: boolean };
      if (res.ok) {
        set({ autoSyncIntervalSec: sec });
        return true;
      }
    } catch (e) {
      console.warn('[reticulumPropagationStore] auto-sync interval ' + errLikeToLogString(e));
    }
    return false;
  },

  startSync: async (id) => {
    const propId = id ?? get().preferredId;
    if (!propId) return false;
    clearPropagationSyncStallWatchdog();
    set({ sync: { active: true, progress: 0, message: null }, lastSyncError: null });
    schedulePropagationSyncStallWatchdog();
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/sync', {
        propagation_id: propId,
      })) as { ok?: boolean; error?: string };
      if (!res.ok) {
        clearPropagationSyncStallWatchdog();
        set({ sync: { active: false, progress: 0, message: null } });
      }
      return Boolean(res.ok);
    } catch (e) {
      clearPropagationSyncStallWatchdog();
      console.warn('[reticulumPropagationStore] sync ' + errLikeToLogString(e));
      set({ sync: { active: false, progress: 0, message: null } });
      return false;
    }
  },

  cancelSync: async () => {
    try {
      clearPropagationSyncStallWatchdog();
      await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/sync/cancel', {});
      set({ sync: { active: false, progress: 0, message: null } });
      return true;
    } catch (e) {
      console.warn('[reticulumPropagationStore] cancel ' + errLikeToLogString(e));
      return false;
    }
  },

  addPropagationNode: async (destinationHash, name) => {
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/add', {
        destination_hash: destinationHash,
        name: name ?? undefined,
      })) as { ok?: boolean };
      if (res.ok) {
        await get().refreshFromSidecar();
        return true;
      }
    } catch (e) {
      console.warn('[reticulumPropagationStore] add node ' + errLikeToLogString(e));
    }
    return false;
  },
}));
