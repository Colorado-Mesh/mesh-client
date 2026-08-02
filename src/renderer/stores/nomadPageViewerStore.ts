import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  DEFAULT_NOMAD_NODE_PAGE_PATH,
  formatNomadRequestDataForUrlBar,
  normalizeNomadPagePath,
  normalizeNomadPageRequestData,
} from '@/renderer/lib/nomad/micronParser';
import {
  clearNomadPageCache,
  getNomadPageCache,
  MAX_NOMAD_PAGE_CACHE_CHARS,
  setNomadPageCache,
} from '@/renderer/lib/nomad/nomadPageCache';
import {
  type NomadPageErrorDiag,
  nomadPageErrorDiagFromResponse,
  shouldForceNomadPathRefreshRetry,
} from '@/renderer/lib/nomad/nomadPageErrorHumanize';
import {
  asNomadPageProgressPayload,
  mapNomadPageProgress,
  type NomadPageLoadingProgress,
  nomadPageProgressMatchesLoad,
} from '@/renderer/lib/nomad/nomadPageProgress';
import {
  NOMAD_PAGE_FETCH_DEBOUNCE_MS,
  NOMAD_PAGE_FETCH_RETRY_SETTLE_MS,
} from '@/renderer/lib/timeConstants';
import type { NomadNodeRow, NomadPageRequestData, NomadPageResponse } from '@/shared/nomad-types';
import {
  nomadPageOverallTimeoutSecs,
  parseReticulumNomadEgressVia,
} from '@/shared/reticulumNomadTimeouts';

import { pushAppToast } from '../components/Toast';
import { useNomadNetworkStore } from './nomadNetworkStore';

/** Cap displayed page size — aligned with NomadNetworkPanel / page cache. */
const MAX_NOMAD_PAGE_DISPLAY_CHARS = MAX_NOMAD_PAGE_CACHE_CHARS;

export interface NomadPageErrorNodeSnapshot {
  hash: string;
  lastSeen: number | null;
  hops: number | null;
}

export interface NomadPageLoadOptions {
  fromHistory?: boolean;
  forceReload?: boolean;
  forcePathRefresh?: boolean;
  requestData?: NomadPageRequestData;
}

interface NomadPageViewerState {
  selectedHash: string | null;
  pagePath: string;
  pageRequestData: NomadPageRequestData | undefined;
  pageContent: string | null;
  pageContentType: string | undefined;
  /** True when displayed content was truncated for renderer safety. */
  pageContentTruncated: boolean;
  pageLoading: boolean;
  /** Wall-clock start of the active load (survives panel unmount). */
  pageLoadingStartedAt: number | null;
  /** Sidecar/proxy budget used for the countdown (seconds). */
  pageLoadingBudgetSec: number;
  /** True while the one-shot force-path auto-retry is running (explain countdown restart). */
  pageLoadingRetrying: boolean;
  /** Live sidecar progress while a page Link/failover is in flight. */
  pageLoadingProgress: NomadPageLoadingProgress | null;
  /** Interface names observed via progress events during this load (incl. auto-retry). */
  pageLoadingTriedIfaces: string[];
  /** Raw sidecar/proxy error code or message (humanize in UI). */
  pageErrorRaw: string | null;
  /** Sidecar egress atom from the failed fetch (`tcp` / `rf` / …) for retry policy. */
  pageErrorEgress: string | null;
  /** Path-ensure / force_path diagnostics for richer error copy. */
  pageErrorDiag: NomadPageErrorDiag | null;
  pageErrorNodeSnapshot: NomadPageErrorNodeSnapshot | null;
  announceReloadDone: boolean;
  /** True while Nomad tab is visible — suppress completion toast when true. */
  panelActive: boolean;
  loadGeneration: number;

  setPanelActive: (active: boolean) => void;
  setInvalidUrlError: () => void;
  applyPageProgress: (payload: unknown) => void;
  loadPage: (hash: string, path: string, options?: NomadPageLoadOptions) => Promise<void>;
  closeViewer: () => void;
  clearPageErrorForAnnounceReload: () => void;
  markAnnounceReloadDone: () => void;
}

/** Coalesce identical in-flight page fetches (StrictMode remount / duplicate clicks). */
const inFlightPageFetches = new Map<string, Promise<NomadPageResponse>>();

function pageFetchDedupeKey(
  hash: string,
  path: string,
  requestData: NomadPageRequestData | undefined,
  forcePathRefresh: boolean,
): string {
  const cleanHash = hash.replace(/[^a-fA-F0-9]/g, '').toLowerCase();
  const dataKey = JSON.stringify(requestData ?? {});
  return `${cleanHash}|${path}|${dataKey}|${forcePathRefresh ? '1' : '0'}`;
}

async function fetchNomadPageDeduped(
  hash: string,
  path: string,
  requestData: NomadPageRequestData | undefined,
  forcePathRefresh: boolean,
): Promise<NomadPageResponse> {
  const key = pageFetchDedupeKey(hash, path, requestData, forcePathRefresh);
  const existing = inFlightPageFetches.get(key);
  if (existing) return existing;
  const fetchNomadPage = useNomadNetworkStore.getState().fetchNomadPage;
  const pending = Promise.resolve(
    fetchNomadPage(
      hash,
      path,
      requestData,
      forcePathRefresh ? { forcePathRefresh: true } : undefined,
    ),
  ).finally(() => {
    if (inFlightPageFetches.get(key) === pending) {
      inFlightPageFetches.delete(key);
    }
  });
  inFlightPageFetches.set(key, pending);
  return pending;
}

function formatNomadUrlBar(hash: string, path: string, requestData?: NomadPageRequestData): string {
  const base = `${hash}:${path}`;
  const varSuffix = formatNomadRequestDataForUrlBar(requestData);
  return varSuffix ? `${base}\`${varSuffix}` : base;
}

function truncateNomadPageContent(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_NOMAD_PAGE_DISPLAY_CHARS) {
    return { text: content, truncated: false };
  }
  return { text: content.slice(0, MAX_NOMAD_PAGE_DISPLAY_CHARS), truncated: true };
}

function snapshotNomadNodeForPageError(
  hash: string,
  node: NomadNodeRow | undefined,
): NomadPageErrorNodeSnapshot {
  return {
    hash: hash.toLowerCase(),
    lastSeen: node?.last_seen ?? null,
    hops: node?.hops ?? null,
  };
}

/**
 * Countdown budget for the loading UI.
 * Default to TCP/MeshChat (45s): Nomad nodes reached over hubs are not RF just
 * because a local BLE RNode is enabled. Only use RF scaling when egress is
 * explicitly `rf` / `ble`.
 */
export function nomadPageLoadingBudgetSec(hops: number | undefined, egressHint?: string): number {
  const egress = parseReticulumNomadEgressVia(egressHint);
  if (egress === 'rf') {
    const hopCount = hops != null && Number.isFinite(hops) ? Math.max(1, Math.trunc(hops)) : 8;
    return nomadPageOverallTimeoutSecs('rf', Math.max(hopCount, 8));
  }
  return nomadPageOverallTimeoutSecs('tcp', 1);
}

/** Remaining seconds until the load budget elapses (0 when overdue). */
export function nomadPageLoadingRemainingSec(
  startedAt: number | null,
  budgetSec: number,
  now = Date.now(),
): number {
  if (startedAt == null || budgetSec <= 0) return 0;
  const elapsed = Math.floor((now - startedAt) / 1000);
  return Math.max(0, budgetSec - elapsed);
}

/** Format remaining seconds as m:ss for the loading countdown. */
export function formatNomadPageCountdown(remainingSec: number): string {
  const s = Math.max(0, Math.floor(remainingSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const initialViewerState = {
  selectedHash: null as string | null,
  pagePath: DEFAULT_NOMAD_NODE_PAGE_PATH,
  pageRequestData: undefined as NomadPageRequestData | undefined,
  pageContent: null as string | null,
  pageContentType: undefined as string | undefined,
  pageContentTruncated: false,
  pageLoading: false,
  pageLoadingStartedAt: null as number | null,
  pageLoadingBudgetSec: 0,
  pageLoadingRetrying: false,
  pageLoadingProgress: null as NomadPageLoadingProgress | null,
  pageLoadingTriedIfaces: [] as string[],
  pageErrorRaw: null as string | null,
  pageErrorEgress: null as string | null,
  pageErrorDiag: null as NomadPageErrorDiag | null,
  pageErrorNodeSnapshot: null as NomadPageErrorNodeSnapshot | null,
  announceReloadDone: false,
  panelActive: false,
  loadGeneration: 0,
};

function egressFromNomadPageResponse(res: NomadPageResponse): string | null {
  if (typeof res.egress !== 'string') return null;
  const trimmed = res.egress.trim();
  return trimmed || null;
}

function mergeTriedInterfaces(
  accumulated: string[],
  fromRes: string[] | null | undefined,
): string[] | null {
  const out: string[] = [];
  for (const name of [...accumulated, ...(fromRes ?? [])]) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (out.some((n) => n.toLowerCase() === trimmed.toLowerCase())) continue;
    out.push(trimmed);
  }
  return out.length > 0 ? out : null;
}

/** Force-path retry countdown: prefer sidecar proof budget; clamp only when link_hops absent. */
function nomadPageRetryLoadingBudgetSec(
  res: NomadPageResponse,
  nodeHops: number | null | undefined,
): number {
  const pathRefreshSec = 4;
  if (typeof res.proof_budget_secs === 'number' && Number.isFinite(res.proof_budget_secs)) {
    return pathRefreshSec + Math.max(0, Math.trunc(res.proof_budget_secs));
  }
  if (typeof res.link_hops === 'number' && Number.isFinite(res.link_hops)) {
    return pathRefreshSec + Math.max(1, Math.trunc(res.link_hops)) * 6;
  }
  // path_timeout (and similar) responses omit link_hops — local clamp fallback.
  const pathHops =
    typeof res.path_hops === 'number' && Number.isFinite(res.path_hops)
      ? Math.max(1, Math.trunc(res.path_hops))
      : Math.max(1, nodeHops ?? 8);
  const retryEgress = egressFromNomadPageResponse(res);
  const retryLinkHops =
    retryEgress === 'rf' || retryEgress === 'ble'
      ? Math.min(32, pathHops)
      : Math.min(7, Math.max(3, pathHops));
  return pathRefreshSec + retryLinkHops * 6;
}

export const useNomadPageViewerStore = create<NomadPageViewerState>((set, get) => ({
  ...initialViewerState,

  setPanelActive: (active) => {
    set({ panelActive: active });
  },

  applyPageProgress: (payload) => {
    const progress = asNomadPageProgressPayload(payload);
    if (!progress) return;
    const state = get();
    if (!state.pageLoading) return;
    if (!nomadPageProgressMatchesLoad(progress, state.selectedHash, state.pagePath)) return;
    const mapped = mapNomadPageProgress(progress);
    if (!mapped) return;
    const add = mapped.addBudgetSecs ?? 0;
    const iface =
      typeof progress.iface === 'string' && progress.iface.trim() ? progress.iface.trim() : null;
    const phase = progress.phase?.trim().toLowerCase();
    let tried = state.pageLoadingTriedIfaces;
    if (
      iface &&
      (phase === 'link_attempt' || phase === 'failover') &&
      !tried.some((n) => n.toLowerCase() === iface.toLowerCase())
    ) {
      tried = [...tried, iface];
    }
    set({
      pageLoadingProgress: mapped,
      pageLoadingTriedIfaces: tried,
      pageLoadingBudgetSec: add > 0 ? state.pageLoadingBudgetSec + add : state.pageLoadingBudgetSec,
    });
  },

  clearPageErrorForAnnounceReload: () => {
    set({
      pageErrorRaw: null,
      pageErrorEgress: null,
      pageErrorDiag: null,
      pageErrorNodeSnapshot: null,
    });
  },

  markAnnounceReloadDone: () => {
    set({ announceReloadDone: true });
  },

  setInvalidUrlError: () => {
    set({
      pageErrorRaw: 'invalid_url',
      pageErrorEgress: null,
      pageErrorDiag: null,
      pageErrorNodeSnapshot: null,
      pageLoading: false,
      pageLoadingStartedAt: null,
      pageLoadingRetrying: false,
      pageLoadingBudgetSec: 0,
      pageLoadingProgress: null,
      pageLoadingTriedIfaces: [],
    });
  },

  closeViewer: () => {
    set({
      ...initialViewerState,
      loadGeneration: get().loadGeneration + 1,
      panelActive: get().panelActive,
    });
    clearNomadPageCache();
  },

  loadPage: async (hash, path, options = {}) => {
    const normalizedPath = normalizeNomadPagePath(path);
    const normalizedRequest = normalizeNomadPageRequestData(options.requestData);
    const generation = get().loadGeneration + 1;
    const nodes = useNomadNetworkStore.getState().nodes;
    const node = nodes.get(hash.toLowerCase());
    // Default TCP/MeshChat until the sidecar reports this request's egress — do not
    // use cached local outbound via (BLE RNode would falsely extend hub countdowns).
    let budgetSec = nomadPageLoadingBudgetSec(node?.hops ?? undefined);

    // Selection updates immediately; countdown starts only when the wire fetch begins
    // so rapid node clicks during debounce do not keep resetting the timer.
    set({
      selectedHash: hash,
      pagePath: normalizedPath,
      pageRequestData: normalizedRequest,
      pageLoading: true,
      pageLoadingStartedAt: null,
      pageLoadingBudgetSec: budgetSec,
      pageLoadingRetrying: false,
      pageLoadingProgress: null,
      pageLoadingTriedIfaces: [],
      pageErrorRaw: null,
      pageErrorEgress: null,
      pageErrorDiag: null,
      pageErrorNodeSnapshot: null,
      announceReloadDone: false,
      loadGeneration: generation,
      pageContent: options.forceReload ? null : get().pageContent,
      pageContentType: options.forceReload ? undefined : get().pageContentType,
      pageContentTruncated: options.forceReload ? false : get().pageContentTruncated,
    });

    if (!options.forceReload) {
      const cached = getNomadPageCache({
        hash,
        path: normalizedPath,
        requestData: normalizedRequest,
      });
      if (cached) {
        if (get().loadGeneration !== generation) return;
        set({
          pageLoading: false,
          pageLoadingStartedAt: null,
          pageLoadingBudgetSec: 0,
          pageLoadingRetrying: false,
          pageLoadingProgress: null,
          pageLoadingTriedIfaces: [],
          pageContent: cached.content,
          pageContentType: cached.content_type,
          pageContentTruncated: false,
        });
        return;
      }
    }

    set({ pageContent: null, pageContentType: undefined, pageContentTruncated: false });

    if (!options.forcePathRefresh) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, NOMAD_PAGE_FETCH_DEBOUNCE_MS);
      });
      if (get().loadGeneration !== generation) {
        return;
      }
    }

    // Do not await a prior fetch — sidecar preempts the old Link query. Leaving the
    // Nomad tab does not bump generation, so background loads keep running.
    let res: NomadPageResponse;
    try {
      const startedAt = Date.now();
      set({ pageLoadingStartedAt: startedAt, pageLoadingBudgetSec: budgetSec });
      res = await fetchNomadPageDeduped(
        hash,
        normalizedPath,
        normalizedRequest,
        !!options.forcePathRefresh,
      );
      if (get().loadGeneration !== generation) {
        return;
      }

      if (typeof res.egress === 'string' && res.egress.trim()) {
        budgetSec = nomadPageLoadingBudgetSec(node?.hops ?? undefined, res.egress);
        set({ pageLoadingBudgetSec: budgetSec });
      }

      // Caller already forced (announce reload / manual ↻) — do not DropPath again.
      if (
        !options.forcePathRefresh &&
        (!res.ok || !res.content) &&
        shouldForceNomadPathRefreshRetry(
          res.error,
          egressFromNomadPageResponse(res),
          nomadPageErrorDiagFromResponse(res),
        )
      ) {
        const retryCode = res.error?.trim() || 'unknown';
        console.warn(`[NomadNetwork] page fetch retry after ${retryCode}`);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, NOMAD_PAGE_FETCH_RETRY_SETTLE_MS);
        });
        if (get().loadGeneration !== generation) return;
        // Restart countdown for the retry using the sidecar proof window (not a
        // fresh fake 45s) so the timer does not jump back up mid-load.
        budgetSec = nomadPageRetryLoadingBudgetSec(res, node?.hops);
        set({
          pageLoadingStartedAt: Date.now(),
          pageLoadingBudgetSec: budgetSec,
          pageLoadingRetrying: true,
          // Keep pageLoadingTriedIfaces — progress events continue accumulating.
          pageLoadingProgress: null,
        });
        res = await fetchNomadPageDeduped(hash, normalizedPath, normalizedRequest, true);
        if (get().loadGeneration !== generation) return;
        if (typeof res.egress === 'string' && res.egress.trim()) {
          budgetSec = nomadPageLoadingBudgetSec(node?.hops ?? undefined, res.egress);
          set({ pageLoadingBudgetSec: budgetSec });
        }
      }
    } catch (e) {
      // Failure point: unexpected fetchNomadPage reject. Fallback: clear loading + raw error.
      console.warn('[NomadNetwork] page fetch ' + errLikeToLogString(e));
      if (get().loadGeneration !== generation) return;
      const liveNode = useNomadNetworkStore.getState().nodes.get(hash.toLowerCase());
      set({
        pageLoading: false,
        pageLoadingStartedAt: null,
        pageLoadingRetrying: false,
        pageLoadingProgress: null,
        pageLoadingTriedIfaces: [],
        pageErrorRaw: 'unknown',
        pageErrorEgress: null,
        pageErrorDiag: null,
        pageErrorNodeSnapshot: snapshotNomadNodeForPageError(hash, liveNode),
      });
      return;
    }

    if (get().loadGeneration !== generation) return;

    if (!res.ok || !res.content) {
      const rawCode = res.error?.trim() || 'unknown';
      const liveNode = useNomadNetworkStore.getState().nodes.get(hash.toLowerCase());
      const fromRes = nomadPageErrorDiagFromResponse(res);
      const accumulated = get().pageLoadingTriedIfaces;
      const mergedTried = mergeTriedInterfaces(accumulated, fromRes.triedInterfaces);
      set({
        pageLoading: false,
        pageLoadingStartedAt: null,
        pageLoadingRetrying: false,
        pageLoadingProgress: null,
        pageLoadingTriedIfaces: [],
        pageErrorRaw: rawCode,
        pageErrorEgress: egressFromNomadPageResponse(res),
        pageErrorDiag: { ...fromRes, triedInterfaces: mergedTried },
        pageErrorNodeSnapshot: snapshotNomadNodeForPageError(hash, liveNode),
        announceReloadDone: false,
      });
      return;
    }

    const { text, truncated } = truncateNomadPageContent(res.content);
    setNomadPageCache(
      {
        hash,
        path: normalizedPath,
        requestData: normalizedRequest,
      },
      {
        content: truncated ? text : res.content,
        content_type: res.content_type,
      },
    );
    set({
      pageLoading: false,
      pageLoadingStartedAt: null,
      pageLoadingBudgetSec: 0,
      pageLoadingRetrying: false,
      pageLoadingProgress: null,
      pageLoadingTriedIfaces: [],
      pageContent: text,
      pageContentType: res.content_type,
      pageContentTruncated: truncated,
      pageErrorRaw: null,
      pageErrorEgress: null,
      pageErrorDiag: null,
      pageErrorNodeSnapshot: null,
    });

    if (!get().panelActive) {
      const label = node?.display_name?.trim() || hash.slice(0, 8);
      // Lazy import avoids pulling i18n into panel unit-test graphs.
      void import('@/renderer/lib/i18n').then(({ default: i18n }) => {
        pushAppToast(i18n.t('nomadNetwork.pageReadyToast', { name: label }), 'success', 6_000);
      });
    }
  },
}));

/** @internal test helper */
export function resetNomadPageViewerStoreForTests(): void {
  inFlightPageFetches.clear();
  // Advance generation so in-flight loads from a prior test cannot apply results.
  const loadGeneration = useNomadPageViewerStore.getState().loadGeneration + 1_000;
  useNomadPageViewerStore.setState({ ...initialViewerState, loadGeneration });
}

export function formatNomadViewerUrlBar(
  hash: string,
  path: string,
  requestData?: NomadPageRequestData,
): string {
  return formatNomadUrlBar(hash, path, requestData);
}
