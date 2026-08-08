import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumPropagationMode } from '@/renderer/lib/reticulum/reticulumPropagationMode';
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
import {
  DEFAULT_PN_HOSTING_POLICY,
  mapPnHostingPolicyError,
  parsePnHostingPolicy,
  type PnHostingPolicy,
  sanitizePnHostingPolicy,
} from '@/shared/pnHostingPolicy';
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
  hostingPolicy: PnHostingPolicy;
  sync: PropagationSyncState;
  lastSyncError: string | null;
  lastAddError: string | null;
  /** i18n key or mapped hosting-policy error for Advanced PN hosting save. */
  lastHostingPolicyError: string | null;
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
  /** Push the renderer propagation mode so the sidecar gates its outbound PN cascade. */
  setModeOnSidecar: (mode: ReticulumPropagationMode) => Promise<boolean>;
  setHostingPolicyOnSidecar: (policy: PnHostingPolicy) => Promise<boolean>;
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
  hostingPolicy: { ...DEFAULT_PN_HOSTING_POLICY },
  sync: { active: false, progress: 0, message: null },
  lastSyncError: null,
  lastAddError: null,
  lastHostingPolicyError: null,
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
        pn_hosting_policy?: unknown;
        last_propagation_sync_at?: number | null;
      };
      const nodes = body.propagation ?? [];
      const nowMs = Date.now();
      let lastPropagationSyncAt = get().lastPropagationSyncAt;
      if (typeof body.last_propagation_sync_at === 'number' && body.last_propagation_sync_at > 0) {
        const fromSidecarMs = body.last_propagation_sync_at * 1000;
        if (fromSidecarMs > nowMs) {
          console.debug(
            '[reticulumPropagationStore] clamping future last_propagation_sync_at from sidecar',
          );
          lastPropagationSyncAt = nowMs;
        } else {
          lastPropagationSyncAt = fromSidecarMs;
        }
      }
      const syncActive = get().sync.active;
      set({
        nodes,
        preferredId: body.preferred_id ?? null,
        autoSyncIntervalSec:
          body.auto_sync_interval_sec ?? RETICULUM_PROPAGATION_AUTO_SYNC_DEFAULT_SEC,
        hostingPolicy: parsePnHostingPolicy(body.pn_hosting_policy),
        lastRefreshedAt: nowMs,
        lastPropagationSyncAt,
        // Clear phantom in-flight stamps only when sync is idle — mid-sync refresh
        // must keep the attempt stamp for WS completion correlation.
        ...(syncActive ? {} : { activePropagationSyncAttemptAt: null }),
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

  setModeOnSidecar: async (mode) => {
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/mode', {
        mode,
      })) as { ok?: boolean };
      return res.ok === true;
    } catch (e) {
      console.warn('[reticulumPropagationStore] set propagation mode ' + errLikeToLogString(e));
      return false;
    }
  },

  setHostingPolicyOnSidecar: async (policy) => {
    const sanitized = sanitizePnHostingPolicy(policy);
    if (!sanitized.ok) {
      set({ lastHostingPolicyError: mapPnHostingPolicyError(sanitized.error) });
      return false;
    }
    try {
      const res = (await window.electronAPI.reticulum.proxyPost(
        '/api/v1/propagation/hosting-policy',
        sanitized.policy,
      )) as { ok?: boolean; error?: string };
      if (res.ok) {
        set({ hostingPolicy: sanitized.policy, lastHostingPolicyError: null });
        return true;
      }
      set({
        lastHostingPolicyError: res.error
          ? mapPnHostingPolicyError(res.error) ||
            mapPropagationSyncError(res.error) ||
            'networkPanel.reticulumPnHosting.saveFailed'
          : 'networkPanel.reticulumPnHosting.saveFailed',
      });
    } catch (e) {
      console.warn('[reticulumPropagationStore] hosting policy ' + errLikeToLogString(e));
      set({ lastHostingPolicyError: 'networkPanel.reticulumPnHosting.saveFailed' });
    }
    return false;
  },

  startSync: async (id) => {
    const propId = id ?? get().preferredId;
    if (!propId) return false;
    const isDestHash = /^[0-9a-fA-F]{32}$/.test(propId);
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
      const body = isDestHash
        ? { destination_hash: propId.toLowerCase() }
        : { propagation_id: propId };
      const res = (await window.electronAPI.reticulum.proxyPost(
        '/api/v1/propagation/sync',
        body,
      )) as { ok?: boolean; error?: string };
      if (!res.ok) {
        clearPropagationSyncStallWatchdog();
        // Soft defer: outbound LXMF deposit owns the PN Link — retry on next auto-sync tick.
        if (res.error === 'PROPAGATION_SYNC_OUTBOUND_BUSY') {
          set({
            sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
            lastSyncError: null,
            activePropagationSyncAttemptAt: null,
          });
          return false;
        }
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
    const applyCancelIdle = (lastSyncError: string) => {
      set({
        sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
        lastSyncError,
        activePropagationSyncAttemptAt: null,
      });
    };
    const resolveCancelError = (existing: string | null, fallback: string): string => {
      // Prefer a sidecar WS failure already applied while cancel awaited; do not let
      // a generic cancel overwrite establish/offer keys (dual 60s watchdog race).
      const keepSidecar =
        existing != null &&
        existing !== PROPAGATION_SYNC_USER_CANCEL_KEY &&
        existing !== 'reticulumPropagation.syncTimedOut';
      return keepSidecar && existing != null ? existing : fallback;
    };
    try {
      clearPropagationSyncStallWatchdog();
      const res = (await window.electronAPI.reticulum.proxyPost(
        '/api/v1/propagation/sync/cancel',
        {},
      )) as { ok?: boolean; error?: string };
      const fallback = opts?.reasonKey ?? PROPAGATION_SYNC_USER_CANCEL_KEY;
      if (res.ok === false || res.error) {
        const mapped = mapPropagationSyncError(res.error);
        applyCancelIdle(
          resolveCancelError(get().lastSyncError, mapped ?? PROPAGATION_SYNC_USER_CANCEL_KEY),
        );
        return false;
      }
      applyCancelIdle(resolveCancelError(get().lastSyncError, fallback));
      return true;
    } catch (e) {
      console.warn('[reticulumPropagationStore] cancel ' + errLikeToLogString(e));
      // Proxy failure must not leave sync.active stuck true.
      const fallback = opts?.reasonKey ?? PROPAGATION_SYNC_USER_CANCEL_KEY;
      applyCancelIdle(resolveCancelError(get().lastSyncError, fallback));
      return false;
    }
  },

  addPropagationNode: async (destinationHash, name) => {
    set({ lastAddError: null });
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/propagation/add', {
        destination_hash: destinationHash,
        name: name ?? undefined,
      })) as { ok?: boolean; error?: string };
      if (res.ok) {
        await get().refreshFromSidecar();
        return true;
      }
      if (res.error) {
        set({
          lastAddError: mapPropagationSyncError(res.error) ?? 'reticulumPropagation.addFailed',
        });
      }
    } catch (e) {
      console.warn('[reticulumPropagationStore] add node ' + errLikeToLogString(e));
      set({ lastAddError: 'reticulumPropagation.addFailed' });
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
      const preferredOk = await get().setPreferredOnSidecar(id);
      await get().refreshFromSidecar();
      if (!preferredOk) return false;
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
