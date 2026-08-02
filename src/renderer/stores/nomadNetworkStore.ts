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

interface NomadFetchLogDiag {
  pathHops?: number;
  linkHops?: number;
  proofBudgetSecs?: number;
  timeoutSecs?: number;
  forcePathOk?: boolean;
  pathEnsureKind?: string;
  elapsedMs?: number;
  rawError?: string;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function diagFieldsFromResponse(res: unknown): NomadFetchLogDiag {
  const r = res as {
    path_hops?: unknown;
    link_hops?: unknown;
    proof_budget_secs?: unknown;
    timeout_secs?: unknown;
    force_path_ok?: unknown;
    path_ensure_kind?: unknown;
    elapsed_ms?: unknown;
    raw_error?: unknown;
  };
  const rawError = typeof r.raw_error === 'string' ? r.raw_error.trim() : undefined;
  const pathEnsureKind =
    typeof r.path_ensure_kind === 'string' && r.path_ensure_kind.trim()
      ? r.path_ensure_kind.trim()
      : undefined;
  return {
    pathHops: optionalFiniteNumber(r.path_hops),
    linkHops: optionalFiniteNumber(r.link_hops),
    proofBudgetSecs: optionalFiniteNumber(r.proof_budget_secs),
    timeoutSecs: optionalFiniteNumber(r.timeout_secs),
    forcePathOk: optionalBoolean(r.force_path_ok),
    pathEnsureKind,
    elapsedMs: optionalFiniteNumber(r.elapsed_ms),
    rawError: rawError || undefined,
  };
}

function appendNomadDiagParts(parts: string[], diag: NomadFetchLogDiag): void {
  if (diag.pathHops != null) parts.push(`path_hops=${diag.pathHops}`);
  if (diag.linkHops != null) parts.push(`link_hops=${diag.linkHops}`);
  if (diag.proofBudgetSecs != null) parts.push(`proof_budget_secs=${diag.proofBudgetSecs}`);
  if (diag.timeoutSecs != null) parts.push(`timeout_secs=${diag.timeoutSecs}`);
  if (diag.forcePathOk != null) parts.push(`force_path_ok=${diag.forcePathOk}`);
  if (diag.pathEnsureKind) parts.push(`path_ensure=${diag.pathEnsureKind}`);
  if (diag.elapsedMs != null) parts.push(`elapsed_ms=${diag.elapsedMs}`);
  if (diag.rawError) {
    parts.push(`raw=${diag.rawError.replace(/[\r\n]+/g, ' ').slice(0, 200)}`);
  }
}

/** Failure-only warn — keep link-budget / path-ensure fields for triage (not success spam). */
function logNomadFetchFailure(
  kind: 'page' | 'file',
  opts: {
    hash: string;
    path: string;
    hops: number;
    egress: string;
    error: string;
    diag?: NomadFetchLogDiag;
  },
): void {
  const pathSafe = opts.path.replace(/[\r\n]+/g, ' ').slice(0, 200);
  const errorSafe = opts.error.replace(/[\r\n]+/g, ' ').slice(0, 200);
  const parts = [
    `path=${pathSafe}`,
    `hops=${opts.hops}`,
    `egress=${opts.egress}`,
    `error=${errorSafe}`,
  ];
  appendNomadDiagParts(parts, opts.diag ?? {});
  console.warn(
    `[nomadNetworkStore] ${kind} fetch failed hash=${nomadHashPrefixForLog(opts.hash)}… ` +
      parts.join(' '),
  );
}

function hopsForNomadHash(nodes: Map<string, NomadNodeRow>, hash: string): number {
  return nodes.get(hash.toLowerCase())?.hops ?? 8;
}

async function fetchNomadResource<T extends { ok: boolean; error?: string }>(
  kind: 'page' | 'file',
  opts: {
    hash: string;
    path: string;
    nodes: Map<string, NomadNodeRow>;
    requestData?: NomadPageRequestData;
    forcePathRefresh?: boolean;
    /** Echoed on sidecar `nomad.page_progress` for load correlation. */
    requestId?: string;
  },
): Promise<T> {
  const hops = hopsForNomadHash(opts.nodes, opts.hash);
  if (!(await isReticulumSidecarRunning())) {
    logNomadFetchFailure(kind, {
      hash: opts.hash,
      path: opts.path,
      hops,
      egress: 'unknown',
      error: 'sidecar_not_running',
    });
    return { ok: false, error: 'sidecar_not_running' } as T;
  }
  try {
    // Sidecar recomputes path-table egress for its Link deadline; main uses a flat
    // Nomad proxy timeout. Cached local egress is logging-only (never block on GET).
    const egress = cachedNomadEgressAt > 0 ? cachedNomadEgress : 'network';
    void resolveNomadEgress().catch((e: unknown) => {
      console.warn('[nomadNetworkStore] resolveNomadEgress ' + errLikeToLogString(e));
    });
    const qs = new URLSearchParams({ path: opts.path });
    if (opts.requestData && Object.keys(opts.requestData).length > 0) {
      qs.set('data', btoa(JSON.stringify(opts.requestData)));
    }
    if (opts.forcePathRefresh) {
      qs.set('force_path_refresh', 'true');
    }
    const requestId = opts.requestId?.trim();
    if (requestId) {
      qs.set('request_id', requestId);
    }
    const cleanHash = opts.hash.replace(/[^a-fA-F0-9]/g, '');
    const apiPath = `/api/v1/nomadnetwork/${kind}/${cleanHash}?${qs.toString()}`;
    const res = (await window.electronAPI.reticulum.proxyGet(apiPath)) as T;
    if (!res.ok) {
      const resRecord = res as { egress?: unknown };
      const resEgress = typeof resRecord.egress === 'string' ? resRecord.egress : egress;
      const diag = diagFieldsFromResponse(res);
      logNomadFetchFailure(kind, {
        hash: cleanHash,
        path: opts.path,
        hops,
        egress: resEgress,
        error: res.error?.trim() || 'unknown',
        diag,
      });
    }
    return res;
  } catch (e) {
    // catch-no-log-ok logged via logNomadFetchFailure below
    const error = errLikeToLogString(e);
    logNomadFetchFailure(kind, {
      hash: opts.hash,
      path: opts.path,
      hops: hopsForNomadHash(opts.nodes, opts.hash),
      egress: cachedNomadEgress,
      error,
    });
    return { ok: false, error } as T;
  }
}

export interface FetchNomadPageOpts {
  forcePathRefresh?: boolean;
  requestId?: string;
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
    opts?: FetchNomadPageOpts,
  ) => Promise<NomadPageResponse>;
  fetchNomadFile: (
    hash: string,
    path: string,
    opts?: FetchNomadPageOpts,
  ) => Promise<NomadFileResponse>;
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
      void resolveNomadEgress().catch((err: unknown) => {
        console.warn('[nomadNetworkStore] resolveNomadEgress ' + errLikeToLogString(err));
      });
    } catch (e) {
      if (isReticulumSidecar404Error(e)) {
        set({ nomadApiAvailable: false });
      } else if (!isReticulumSidecarExpectedProxyError(e)) {
        console.warn('[nomadNetworkStore] refresh ' + errLikeToLogString(e));
      }
    }
  },

  fetchNomadPage: async (hash, path, requestData, opts) =>
    fetchNomadResource<NomadPageResponse>('page', {
      hash,
      path,
      nodes: get().nodes,
      requestData,
      forcePathRefresh: opts?.forcePathRefresh,
      requestId: opts?.requestId,
    }),

  fetchNomadFile: async (hash, path, opts) =>
    fetchNomadResource<NomadFileResponse>('file', {
      hash,
      path,
      nodes: get().nodes,
      forcePathRefresh: opts?.forcePathRefresh,
      requestId: opts?.requestId,
    }),

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
