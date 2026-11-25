import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isReticulumSidecarExpectedProxyError,
  isReticulumSidecarRunning,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { RrcHubInfo, RrcHubNameSource } from '@/shared/rrc-types';

const NAME_PRIORITY: Record<RrcHubNameSource, number> = {
  recommended: 40,
  welcome: 30,
  manual: 20,
  announce: 10,
};

function resolveNameSource(hub: RrcHubInfo): RrcHubNameSource {
  if (hub.name_source) return hub.name_source;
  if (hub.recommended) return 'recommended';
  if (hub.source === 'manual') return 'manual';
  return 'announce';
}

function pickFirst<T>(...values: readonly (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

function mergeDisplayName(
  prev: RrcHubInfo | undefined,
  next: RrcHubInfo,
): { display_name: string | null; name_source: RrcHubNameSource | undefined } {
  const prevSource = prev ? resolveNameSource(prev) : undefined;
  const nextSource = resolveNameSource(next);
  if (!next.display_name)
    return { display_name: prev?.display_name ?? null, name_source: prevSource };
  const nextPri = NAME_PRIORITY[nextSource];
  const prevPri = prevSource ? NAME_PRIORITY[prevSource] : 0;
  if (prev?.display_name && nextPri < prevPri) {
    return { display_name: prev.display_name, name_source: prevSource };
  }
  return { display_name: next.display_name, name_source: nextSource };
}

function mergeRrcHub(prev: RrcHubInfo | undefined, next: RrcHubInfo): RrcHubInfo {
  const recommended = Boolean(prev?.recommended) || Boolean(next.recommended);
  const { display_name, name_source } = mergeDisplayName(prev, next);
  return {
    destination_hash: next.destination_hash.toLowerCase(),
    identity_hash: pickFirst(next.identity_hash, prev?.identity_hash),
    display_name,
    name_source,
    last_seen: pickFirst(next.last_seen, prev?.last_seen),
    favorited: pickFirst(next.favorited, prev?.favorited) ?? false,
    hops: pickFirst(next.hops, prev?.hops),
    status: pickFirst(next.status, prev?.status),
    source: pickFirst(next.source, prev?.source) ?? 'discovered',
    recommended,
  };
}

export interface RrcHubStoreState {
  hubs: Map<string, RrcHubInfo>;
  lastRefreshAt: number | null;
  refreshFromSidecar: () => Promise<void>;
  upsertFromEvent: (hub: RrcHubInfo) => void;
  applyWelcomeName: (hash: string, hubName: string) => void;
  toggleFavorite: (hash: string, favorited: boolean) => Promise<void>;
  upsertManual: (hash: string, label?: string) => Promise<RrcHubInfo | null>;
  getHub: (hash: string) => RrcHubInfo | undefined;
  clear: () => void;
}

export const useRrcHubStore = create<RrcHubStoreState>((set, get) => ({
  hubs: new Map(),
  lastRefreshAt: null,

  refreshFromSidecar: async () => {
    try {
      if (!(await isReticulumSidecarRunning())) return;
      const body = (await window.electronAPI.reticulum.rrc.listHubs()) as {
        hubs?: RrcHubInfo[];
      };
      const map = new Map<string, RrcHubInfo>();
      for (const hub of body.hubs ?? []) {
        const key = hub.destination_hash.toLowerCase();
        map.set(key, mergeRrcHub(map.get(key), { ...hub, destination_hash: key }));
      }
      set({ hubs: map, lastRefreshAt: Date.now() });
    } catch (e) {
      if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('mcL1472 [rrcHubStore] refresh ' + errLikeToLogString(e));
      }
    }
  },

  upsertFromEvent: (hub) => {
    const key = hub.destination_hash.toLowerCase();
    set((s) => {
      const next = new Map(s.hubs);
      next.set(key, mergeRrcHub(next.get(key), { ...hub, destination_hash: key }));
      return { hubs: next };
    });
  },

  applyWelcomeName: (hash, hubName) => {
    const name = hubName.trim();
    if (!name) return;
    const key = hash.toLowerCase();
    set((s) => {
      const next = new Map(s.hubs);
      const prev = next.get(key);
      next.set(
        key,
        mergeRrcHub(prev, {
          destination_hash: key,
          display_name: name,
          name_source: 'welcome',
          recommended: prev?.recommended,
          source: prev?.source ?? 'discovered',
        }),
      );
      return { hubs: next };
    });
    void window.electronAPI.reticulum.rrc
      .upsertHub({ dest_hash: key, label: name })
      .catch((e: unknown) => {
        console.debug('[rrcHubStore] welcome name persist ' + errLikeToLogString(e));
      });
  },

  toggleFavorite: async (hash, favorited) => {
    const key = hash.toLowerCase();
    const prev = get().hubs.get(key);
    set((s) => {
      const next = new Map(s.hubs);
      const cur = next.get(key);
      if (cur) next.set(key, { ...cur, favorited });
      return { hubs: next };
    });
    try {
      const res = await window.electronAPI.reticulum.rrc.setFavorite(key, favorited);
      if (!res.ok) {
        console.warn('mcL1473 [rrcHubStore] favorite not ok ' + (res.error ?? ''));
        if (prev) {
          set((s) => {
            const next = new Map(s.hubs);
            next.set(key, prev);
            return { hubs: next };
          });
        } else {
          void get().refreshFromSidecar();
        }
      }
    } catch (e) {
      console.warn('mcL1474 [rrcHubStore] favorite ' + errLikeToLogString(e));
      if (prev) {
        set((s) => {
          const next = new Map(s.hubs);
          next.set(key, prev);
          return { hubs: next };
        });
      } else {
        void get().refreshFromSidecar();
      }
    }
  },

  upsertManual: async (hash, label) => {
    const clean = hash.trim().toLowerCase().replace(/:/g, '');
    if (clean.length !== 32 || !/^[0-9a-f]+$/.test(clean)) {
      return null;
    }
    try {
      const res = (await window.electronAPI.reticulum.rrc.upsertHub({
        dest_hash: clean,
        label,
      })) as { ok?: boolean; hub?: RrcHubInfo; error?: string };
      if (res.ok === false) {
        console.warn('mcL1475 [rrcHubStore] upsertManual not ok ' + (res.error ?? ''));
        return null;
      }
      if (res.hub) {
        get().upsertFromEvent({
          ...res.hub,
          source: 'manual',
          name_source: label ? 'manual' : res.hub.name_source,
        });
        return get().getHub(clean) ?? null;
      }
      // Sidecar accepted but omitted hub payload — refresh rather than fabricate.
      await get().refreshFromSidecar();
      return get().getHub(clean) ?? null;
    } catch (e) {
      console.warn('mcL1476 [rrcHubStore] upsertManual ' + errLikeToLogString(e));
      return null;
    }
  },

  getHub: (hash) => get().hubs.get(hash.toLowerCase()),

  clear: () => {
    set({ hubs: new Map(), lastRefreshAt: null });
  },
}));
