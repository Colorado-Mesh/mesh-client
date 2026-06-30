import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isReticulumSidecar404Error,
  isReticulumSidecarExpectedProxyError,
  isReticulumSidecarRunning,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadNodeRow } from '@/shared/nomad-types';

interface NomadNetworkStoreState {
  nodes: Map<string, NomadNodeRow>;
  lastRefreshAt: number | null;
  nomadApiAvailable: boolean;
  refreshFromSidecar: () => Promise<void>;
  toggleFavorite: (hash: string, favorited: boolean) => Promise<void>;
  getNode: (hash: string) => NomadNodeRow | undefined;
}

export const useNomadNetworkStore = create<NomadNetworkStoreState>((set, get) => ({
  nodes: new Map(),
  lastRefreshAt: null,
  nomadApiAvailable: true,

  refreshFromSidecar: async () => {
    if (!(await isReticulumSidecarRunning())) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/nomadnetwork/nodes')) as {
        nodes?: NomadNodeRow[];
      };
      const map = new Map<string, NomadNodeRow>();
      for (const node of body.nodes ?? []) {
        map.set(node.destination_hash.toLowerCase(), node);
      }
      set({ nodes: map, lastRefreshAt: Date.now(), nomadApiAvailable: true });
    } catch (e) {
      if (isReticulumSidecar404Error(e)) {
        set({ nomadApiAvailable: false });
      } else if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[nomadNetworkStore] refresh ' + errLikeToLogString(e));
      }
    }
  },

  toggleFavorite: async (hash, favorited) => {
    if (!(await isReticulumSidecarRunning())) return;
    try {
      await window.electronAPI.reticulum.proxyPost('/api/v1/nomadnetwork/nodes/favorite', {
        destination_hash: hash,
        favorited,
      });
      const key = hash.toLowerCase();
      const existing = get().nodes.get(key);
      if (existing) {
        const next = new Map(get().nodes);
        next.set(key, { ...existing, favorited });
        set({ nodes: next });
      }
    } catch (e) {
      if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[nomadNetworkStore] favorite ' + errLikeToLogString(e));
      }
    }
  },

  getNode: (hash) => get().nodes.get(hash.toLowerCase()),
}));
