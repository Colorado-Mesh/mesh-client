import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  clearPropagationSyncStallWatchdog,
  mapPropagationSyncError,
  RETICULUM_PROPAGATION_SYNC_IDLE,
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
  /** When the most recent sync attempt began (success or failure). Used for auto-sync backoff. */
  lastPropagationSyncAttemptAt: number | null;
  replaceNodes: (nodes: PropagationNodeRow[]) => void;
  setPreferredId: (id: string | null) => void;
  setSyncState: (patch: Partial<PropagationSyncState>) => void;
  setLastSyncError: (message: string | null) => void;
  setLastPropagationSyncAt: (atMs: number | null) => void;
  setLastPropagationSyncAttemptAt: (atMs: number | null) => void;
  refreshFromSidecar: () => Promise<void>;
  setPreferredOnSidecar: (id: string) => Promise<boolean>;
  setAutoSyncIntervalOnSidecar: (sec: number) => Promise<boolean>;
  startSync: (id?: string) => Promise<boolean>;
  cancelSync: () => Promise<boolean>;
  addPropagationNode: (destinationHash: string, name?: string) => Promise<boolean>;
  removePropagationNode: (id: string) => Promise<boolean>;
  renamePropagationNode: (id: string, name: string) => Promise<boolean>;
}

export const useReticulumPropagationStore = create<ReticulumPropagationStoreState>((set, get) => ({
  nodes: [],
  preferredId: null,
  autoSyncIntervalSec: RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
  sync: { active: false, progress: 0, message: null },
  lastSyncError: null,
  lastRefreshedAt: null,
  lastPropagationSyncAt: null,
  lastPropagationSyncAttemptAt: null,

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

  setLastPropagationSyncAttemptAt: (atMs) => {
    set({ lastPropagationSyncAttemptAt: atMs });
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
    set({
      sync: { active: true, progress: 0, message: null },
      lastSyncError: null,
      lastPropagationSyncAttemptAt: Date.now(),
    });
    // Local inbox settles in-process (no Establishing stall); remotes need the watchdog.
    if (propId !== 'local-prop') {
      schedulePropagationSyncStallWatchdog();
    }
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/sync', {
        propagation_id: propId,
      })) as { ok?: boolean; error?: string };
      if (!res.ok) {
        clearPropagationSyncStallWatchdog();
        set({
          sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
          lastSyncError: mapPropagationSyncError(res.error),
        });
        return false;
      }
      // Local settle has no WS progress stream if the emitter races; mark success here.
      if (propId === 'local-prop') {
        set({
          sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
          lastSyncError: null,
          lastPropagationSyncAt: Date.now(),
        });
      }
      return true;
    } catch (e) {
      clearPropagationSyncStallWatchdog();
      console.warn('[reticulumPropagationStore] sync ' + errLikeToLogString(e));
      set({
        sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
        lastSyncError: mapPropagationSyncError(null),
      });
      return false;
    }
  },

  cancelSync: async () => {
    try {
      clearPropagationSyncStallWatchdog();
      await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/sync/cancel', {});
      // Mark cancelled so a late progress=100 frame cannot advance lastPropagationSyncAt.
      set({
        sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
        lastSyncError: 'reticulumPropagation.syncCancelled',
      });
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

  removePropagationNode: async (id) => {
    try {
      const encodedId = encodeURIComponent(id);
      const res = (await window.electronAPI.reticulum.proxyDelete(
        `/api/v1/propagation/${encodedId}`,
      )) as {
        ok?: boolean;
      };
      if (res.ok) {
        await get().refreshFromSidecar();
        return true;
      }
    } catch (e) {
      console.warn('[reticulumPropagationStore] remove node ' + errLikeToLogString(e));
    }
    return false;
  },

  renamePropagationNode: async (id, name) => {
    try {
      const encodedId = encodeURIComponent(id);
      const res = (await window.electronAPI.reticulum.proxyPut(`/api/v1/propagation/${encodedId}`, {
        name,
      })) as { ok?: boolean };
      if (res.ok) {
        await get().refreshFromSidecar();
        return true;
      }
    } catch (e) {
      console.warn('[reticulumPropagationStore] rename node ' + errLikeToLogString(e));
    }
    return false;
  },
}));
