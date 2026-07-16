import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isReticulumSidecarExpectedProxyError,
  isReticulumSidecarRunning,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { RrcHubInfo } from '@/shared/rrc-types';
import { RRC_DEFAULT_HUBS } from '@/shared/rrcDefaultHubs';

function seedRecommended(): Map<string, RrcHubInfo> {
  const map = new Map<string, RrcHubInfo>();
  for (const hub of RRC_DEFAULT_HUBS) {
    map.set(hub.destinationHash, {
      destination_hash: hub.destinationHash,
      display_name: hub.label,
      source: 'recommended',
      recommended: true,
      favorited: false,
      status: 'recommended',
    });
  }
  return map;
}

function mergeHub(prev: RrcHubInfo | undefined, next: RrcHubInfo): RrcHubInfo {
  const recommended =
    Boolean(prev?.recommended) ||
    Boolean(next.recommended) ||
    RRC_DEFAULT_HUBS.some((h) => h.destinationHash === next.destination_hash.toLowerCase());
  return {
    destination_hash: next.destination_hash.toLowerCase(),
    identity_hash: next.identity_hash ?? prev?.identity_hash ?? null,
    display_name: next.display_name ?? prev?.display_name ?? null,
    last_seen: next.last_seen ?? prev?.last_seen ?? null,
    favorited: next.favorited ?? prev?.favorited ?? false,
    hops: next.hops ?? prev?.hops ?? null,
    status: next.status ?? prev?.status ?? null,
    source: next.source ?? prev?.source ?? 'discovered',
    recommended,
  };
}

interface RrcHubStoreState {
  hubs: Map<string, RrcHubInfo>;
  lastRefreshAt: number | null;
  refreshFromSidecar: () => Promise<void>;
  upsertFromEvent: (hub: RrcHubInfo) => void;
  toggleFavorite: (hash: string, favorited: boolean) => Promise<void>;
  upsertManual: (hash: string, label?: string) => Promise<RrcHubInfo | null>;
  getHub: (hash: string) => RrcHubInfo | undefined;
  clear: () => void;
}

export const useRrcHubStore = create<RrcHubStoreState>((set, get) => ({
  hubs: seedRecommended(),
  lastRefreshAt: null,

  refreshFromSidecar: async () => {
    if (!(await isReticulumSidecarRunning())) return;
    try {
      const body = (await window.electronAPI.reticulum.rrc.listHubs()) as {
        hubs?: RrcHubInfo[];
      };
      const map = seedRecommended();
      for (const hub of body.hubs ?? []) {
        const key = hub.destination_hash.toLowerCase();
        map.set(key, mergeHub(map.get(key), { ...hub, destination_hash: key }));
      }
      set({ hubs: map, lastRefreshAt: Date.now() });
    } catch (e) {
      if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[rrcHubStore] refresh ' + errLikeToLogString(e));
      }
    }
  },

  upsertFromEvent: (hub) => {
    const key = hub.destination_hash.toLowerCase();
    set((s) => {
      const next = new Map(s.hubs);
      next.set(key, mergeHub(next.get(key), { ...hub, destination_hash: key }));
      return { hubs: next };
    });
  },

  toggleFavorite: async (hash, favorited) => {
    const key = hash.toLowerCase();
    set((s) => {
      const next = new Map(s.hubs);
      const prev = next.get(key);
      if (prev) next.set(key, { ...prev, favorited });
      return { hubs: next };
    });
    try {
      await window.electronAPI.reticulum.rrc.setFavorite(key, favorited);
    } catch (e) {
      console.warn('[rrcHubStore] favorite ' + errLikeToLogString(e));
      void get().refreshFromSidecar();
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
      })) as { ok?: boolean; hub?: RrcHubInfo };
      if (res.hub) {
        get().upsertFromEvent({ ...res.hub, source: 'manual' });
        return get().getHub(clean) ?? null;
      }
      get().upsertFromEvent({
        destination_hash: clean,
        display_name: label ?? null,
        source: 'manual',
        recommended: RRC_DEFAULT_HUBS.some((h) => h.destinationHash === clean),
      });
      return get().getHub(clean) ?? null;
    } catch (e) {
      console.warn('[rrcHubStore] upsertManual ' + errLikeToLogString(e));
      return null;
    }
  },

  getHub: (hash) => get().hubs.get(hash.toLowerCase()),

  clear: () => {
    set({ hubs: seedRecommended(), lastRefreshAt: null });
  },
}));
