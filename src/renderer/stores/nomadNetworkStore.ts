import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  resolveReticulumOutboundViaFromInterfaces,
  type ReticulumVia,
} from '@/renderer/lib/reticulum/classifyReticulumVia';
import {
  fetchReticulumInterfaces,
  getCachedReticulumEffectivePrimaryLocalSerialInterfaceId,
  isReticulumSidecar404Error,
  isReticulumSidecarExpectedProxyError,
  isReticulumSidecarRunning,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type {
  NomadFileResponse,
  NomadNodeRow,
  NomadPageRequestData,
  NomadPageResponse,
} from '@/shared/nomad-types';

const NOMAD_EGRESS_CACHE_MS = 60_000;

let cachedNomadEgress: ReticulumVia = 'network';
let cachedNomadEgressAt = 0;

async function resolveNomadEgress(): Promise<ReticulumVia> {
  if (Date.now() - cachedNomadEgressAt < NOMAD_EGRESS_CACHE_MS) {
    return cachedNomadEgress;
  }
  const interfaces = await fetchReticulumInterfaces();
  if (interfaces.length === 0) {
    // Failure point: interfaces query timed out while transport is busy.
    // Fallback: do not cache `network` — retry on the next page fetch.
    return cachedNomadEgressAt > 0 ? cachedNomadEgress : 'network';
  }
  cachedNomadEgress = resolveReticulumOutboundViaFromInterfaces(
    interfaces,
    getCachedReticulumEffectivePrimaryLocalSerialInterfaceId(),
  );
  cachedNomadEgressAt = Date.now();
  return cachedNomadEgress;
}

function invalidateNomadEgressCache(): void {
  cachedNomadEgressAt = 0;
}

/** @internal test helper */
export function resetNomadEgressCacheForTests(): void {
  invalidateNomadEgressCache();
}

function nomadHashPrefixForLog(hash: string): string {
  const clean = hash.replace(/[^a-fA-F0-9]/g, '');
  return clean.slice(0, 8) || 'unknown';
}

function logNomadFetchFailure(
  kind: 'page' | 'file',
  opts: { hash: string; path: string; hops: number; egress: string; error: string },
): void {
  const pathSafe = opts.path.replace(/[\r\n]+/g, ' ').slice(0, 200);
  const errorSafe = opts.error.replace(/[\r\n]+/g, ' ').slice(0, 200);
  console.warn(
    `[nomadNetworkStore] ${kind} fetch failed hash=${nomadHashPrefixForLog(opts.hash)}… ` +
      `path=${pathSafe} hops=${opts.hops} egress=${opts.egress} error=${errorSafe}`,
  );
}

interface NomadNetworkStoreState {
  nodes: Map<string, NomadNodeRow>;
  lastRefreshAt: number | null;
  nomadApiAvailable: boolean;
  refreshFromSidecar: () => Promise<void>;
  fetchNomadPage: (
    hash: string,
    path: string,
    requestData?: NomadPageRequestData,
  ) => Promise<NomadPageResponse>;
  fetchNomadFile: (hash: string, path: string) => Promise<NomadFileResponse>;
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
      invalidateNomadEgressCache();
      void resolveNomadEgress();
    } catch (e) {
      if (isReticulumSidecar404Error(e)) {
        set({ nomadApiAvailable: false });
      } else if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[nomadNetworkStore] refresh ' + errLikeToLogString(e));
      }
    }
  },

  fetchNomadPage: async (hash, path, requestData) => {
    if (!(await isReticulumSidecarRunning())) {
      logNomadFetchFailure('page', {
        hash,
        path,
        hops: 8,
        egress: 'unknown',
        error: 'sidecar_not_running',
      });
      return { ok: false, error: 'sidecar_not_running' };
    }
    try {
      const egress = await resolveNomadEgress();
      const node = get().nodes.get(hash.toLowerCase());
      const hops = node?.hops ?? 8;
      const qs = new URLSearchParams({
        path,
        hops: String(hops),
        egress,
      });
      if (requestData && Object.keys(requestData).length > 0) {
        qs.set('data', btoa(JSON.stringify(requestData)));
      }
      const cleanHash = hash.replace(/[^a-fA-F0-9]/g, '');
      const res = (await window.electronAPI.reticulum.proxyGet(
        `/api/v1/nomadnetwork/page/${cleanHash}?${qs.toString()}`,
      )) as NomadPageResponse;
      if (!res.ok) {
        logNomadFetchFailure('page', {
          hash: cleanHash,
          path,
          hops,
          egress,
          error: res.error?.trim() || 'unknown',
        });
      }
      return res;
    } catch (e) {
      // catch-no-log-ok logged via logNomadFetchFailure below
      const error = errLikeToLogString(e);
      logNomadFetchFailure('page', {
        hash,
        path,
        hops: get().nodes.get(hash.toLowerCase())?.hops ?? 8,
        egress: cachedNomadEgress,
        error,
      });
      return { ok: false, error };
    }
  },

  fetchNomadFile: async (hash, path) => {
    if (!(await isReticulumSidecarRunning())) {
      logNomadFetchFailure('file', {
        hash,
        path,
        hops: 8,
        egress: 'unknown',
        error: 'sidecar_not_running',
      });
      return { ok: false, error: 'sidecar_not_running' };
    }
    try {
      const egress = await resolveNomadEgress();
      const node = get().nodes.get(hash.toLowerCase());
      const hops = node?.hops ?? 8;
      const qs = new URLSearchParams({
        path,
        hops: String(hops),
        egress,
      });
      const cleanHash = hash.replace(/[^a-fA-F0-9]/g, '');
      const res = (await window.electronAPI.reticulum.proxyGet(
        `/api/v1/nomadnetwork/file/${cleanHash}?${qs.toString()}`,
      )) as NomadFileResponse;
      if (!res.ok) {
        logNomadFetchFailure('file', {
          hash: cleanHash,
          path,
          hops,
          egress,
          error: res.error?.trim() || 'unknown',
        });
      }
      return res;
    } catch (e) {
      // catch-no-log-ok logged via logNomadFetchFailure below
      const error = errLikeToLogString(e);
      logNomadFetchFailure('file', {
        hash,
        path,
        hops: get().nodes.get(hash.toLowerCase())?.hops ?? 8,
        egress: cachedNomadEgress,
        error,
      });
      return { ok: false, error };
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
