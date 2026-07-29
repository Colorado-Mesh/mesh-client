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

/** i18n key written when the user cancels an in-flight propagation sync. */
export const PROPAGATION_SYNC_USER_CANCEL_KEY = 'reticulumPropagation.syncCancelled';

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

export interface DiscoveredPropagationRow {
  destination_hash: string;
  identity_hash?: string | null;
  /** 128-char hex PN announce public key when known. */
  public_key?: string | null;
  display_name?: string | null;
  hops?: number | null;
  last_seen?: number | null;
  node_state: boolean;
  peering_cost: number;
}

interface PropagationSyncState {
  active: boolean;
  progress: number;
  message?: string | null;
}

interface ReticulumPropagationStoreState {
  nodes: PropagationNodeRow[];
  discovered: DiscoveredPropagationRow[];
  preferredId: string | null;
  autoSyncIntervalSec: number;
  sync: PropagationSyncState;
  lastSyncError: string | null;
  lastRefreshedAt: number | null;
  lastPropagationSyncAt: number | null;
  /**
   * When the most recent sync attempt began. Kept after failures for auto-sync cooldown;
   * cleared on success only when that completion still owns this stamp.
   */
  lastPropagationSyncAttemptAt: number | null;
  /** Attempt timestamp for the in-flight sync run (WS complete scopes clear to this). */
  activePropagationSyncAttemptAt: number | null;
  replaceNodes: (nodes: PropagationNodeRow[]) => void;
  upsertDiscovered: (row: DiscoveredPropagationRow) => void;
  replaceDiscovered: (rows: DiscoveredPropagationRow[]) => void;
  setPreferredId: (id: string | null) => void;
  setSyncState: (patch: Partial<PropagationSyncState>) => void;
  setLastSyncError: (message: string | null) => void;
  /**
   * Record last successful sync time. When `forAttemptAt` matches the current attempt stamp,
   * clear it (and the active run stamp); a mismatched/older completion leaves a newer attempt alone.
   */
  setLastPropagationSyncAt: (atMs: number | null, forAttemptAt?: number | null) => void;
  setLastPropagationSyncAttemptAt: (atMs: number | null) => void;
  refreshFromSidecar: () => Promise<void>;
  refreshDiscoveredFromSidecar: () => Promise<void>;
  setPreferredOnSidecar: (id: string) => Promise<boolean>;
  setAutoSyncIntervalOnSidecar: (sec: number) => Promise<boolean>;
  startSync: (id?: string) => Promise<boolean>;
  cancelSync: (opts?: { reasonKey?: string }) => Promise<boolean>;
  addPropagationNode: (destinationHash: string, name?: string) => Promise<boolean>;
  addFromDiscovered: (destinationHash: string, opts?: { prefer?: boolean }) => Promise<boolean>;
  removePropagationNode: (id: string) => Promise<boolean>;
  renamePropagationNode: (id: string, name: string) => Promise<boolean>;
}

export const useReticulumPropagationStore = create<ReticulumPropagationStoreState>((set, get) => ({
  nodes: [],
  discovered: [],
  preferredId: null,
  autoSyncIntervalSec: RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
  sync: { active: false, progress: 0, message: null },
  lastSyncError: null,
  lastRefreshedAt: null,
  lastPropagationSyncAt: null,
  lastPropagationSyncAttemptAt: null,
  activePropagationSyncAttemptAt: null,

  replaceNodes: (nodes) => {
    set({ nodes });
  },

  upsertDiscovered: (row) => {
    set((s) => {
      const key = row.destination_hash.toLowerCase();
      const without = s.discovered.filter((d) => d.destination_hash.toLowerCase() !== key);
      return { discovered: [...without, row] };
    });
  },

  replaceDiscovered: (rows) => {
    set({ discovered: rows });
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

  setLastPropagationSyncAt: (atMs, forAttemptAt) => {
    set((s) => {
      if (atMs == null) {
        return { lastPropagationSyncAt: null };
      }
      const clearAttempt = forAttemptAt != null && s.lastPropagationSyncAttemptAt === forAttemptAt;
      const clearActive = forAttemptAt != null && s.activePropagationSyncAttemptAt === forAttemptAt;
      return {
        lastPropagationSyncAt: atMs,
        ...(clearAttempt ? { lastPropagationSyncAttemptAt: null } : {}),
        ...(clearActive ? { activePropagationSyncAttemptAt: null } : {}),
      };
    });
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
      await get().refreshDiscoveredFromSidecar();
    } catch (e) {
      if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[reticulumPropagationStore] refresh ' + errLikeToLogString(e));
      }
    }
  },

  refreshDiscoveredFromSidecar: async () => {
    const sidecarRunning = await isReticulumSidecarRunning();
    if (!sidecarRunning) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/propagation/discovered',
      )) as {
        discovered?: DiscoveredPropagationRow[];
      };
      set({ discovered: body.discovered ?? [] });
    } catch (e) {
      if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[reticulumPropagationStore] discovered ' + errLikeToLogString(e));
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
    // Avoid overlapping renderer starts so a late success cannot clear a newer attempt.
    if (get().sync.active) {
      await get().cancelSync();
    }
    const attemptAt = Date.now();
    clearPropagationSyncStallWatchdog();
    set({
      sync: { active: true, progress: 0, message: null },
      lastSyncError: null,
      lastPropagationSyncAttemptAt: attemptAt,
      activePropagationSyncAttemptAt: attemptAt,
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
          activePropagationSyncAttemptAt: null,
        });
        return false;
      }
      // Local settle has no WS progress stream if the emitter races; mark success here.
      if (propId === 'local-prop') {
        set({
          sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
          lastSyncError: null,
        });
        get().setLastPropagationSyncAt(Date.now(), attemptAt);
      }
      return true;
    } catch (e) {
      clearPropagationSyncStallWatchdog();
      console.warn('[reticulumPropagationStore] sync ' + errLikeToLogString(e));
      set({
        sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
        lastSyncError: mapPropagationSyncError(null),
        activePropagationSyncAttemptAt: null,
      });
      return false;
    }
  },

  cancelSync: async (opts) => {
    try {
      clearPropagationSyncStallWatchdog();
      await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/sync/cancel', {});
      // Prefer a sidecar WS failure already applied while cancel awaited; do not let
      // a generic cancel overwrite establish/offer keys (dual 60s watchdog race).
      set((state) => {
        const fallback = opts?.reasonKey ?? PROPAGATION_SYNC_USER_CANCEL_KEY;
        const existing = state.lastSyncError;
        const keepSidecar =
          existing != null &&
          existing !== PROPAGATION_SYNC_USER_CANCEL_KEY &&
          existing !== 'reticulumPropagation.syncTimedOut';
        return {
          sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
          lastSyncError: keepSidecar ? existing : fallback,
          activePropagationSyncAttemptAt: null,
        };
      });
      return true;
    } catch (e) {
      console.warn('[reticulumPropagationStore] cancel ' + errLikeToLogString(e));
      // Proxy failure must not leave sync.active stuck true.
      set((state) => {
        const fallback = opts?.reasonKey ?? PROPAGATION_SYNC_USER_CANCEL_KEY;
        const existing = state.lastSyncError;
        const keepSidecar =
          existing != null &&
          existing !== PROPAGATION_SYNC_USER_CANCEL_KEY &&
          existing !== 'reticulumPropagation.syncTimedOut';
        return {
          sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
          lastSyncError: keepSidecar ? existing : fallback,
          activePropagationSyncAttemptAt: null,
        };
      });
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

  addFromDiscovered: async (destinationHash, opts) => {
    const row = get().discovered.find(
      (d) => d.destination_hash.toLowerCase() === destinationHash.toLowerCase(),
    );
    const name = row?.display_name?.trim() || undefined;
    const ok = await get().addPropagationNode(destinationHash, name);
    if (!ok) return false;
    if (opts?.prefer) {
      const id = `pn-${destinationHash.toLowerCase().slice(0, 8)}`;
      await get().setPreferredOnSidecar(id);
      await get().refreshFromSidecar();
    }
    return true;
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
