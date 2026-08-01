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
import { shouldForceNomadPathRefreshRetry } from '@/renderer/lib/nomad/nomadPageErrorHumanize';
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
  /** Raw sidecar/proxy error code or message (humanize in UI). */
  pageErrorRaw: string | null;
  pageErrorNodeSnapshot: NomadPageErrorNodeSnapshot | null;
  announceReloadDone: boolean;
  /** True while Nomad tab is visible — suppress completion toast when true. */
  panelActive: boolean;
  loadGeneration: number;

  setPanelActive: (active: boolean) => void;
  setInvalidUrlError: () => void;
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
  pageErrorRaw: null as string | null,
  pageErrorNodeSnapshot: null as NomadPageErrorNodeSnapshot | null,
  announceReloadDone: false,
  panelActive: false,
  loadGeneration: 0,
};

export const useNomadPageViewerStore = create<NomadPageViewerState>((set, get) => ({
  ...initialViewerState,

  setPanelActive: (active) => {
    set({ panelActive: active });
  },

  clearPageErrorForAnnounceReload: () => {
    set({ pageErrorRaw: null, pageErrorNodeSnapshot: null });
  },

  markAnnounceReloadDone: () => {
    set({ announceReloadDone: true });
  },

  setInvalidUrlError: () => {
    set({
      pageErrorRaw: 'invalid_url',
      pageErrorNodeSnapshot: null,
      pageLoading: false,
      pageLoadingStartedAt: null,
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
      pageErrorRaw: null,
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

      if ((!res.ok || !res.content) && shouldForceNomadPathRefreshRetry(res.error)) {
        const retryCode = res.error?.trim() || 'unknown';
        console.warn(`[NomadNetwork] page fetch retry after ${retryCode}`);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, NOMAD_PAGE_FETCH_RETRY_SETTLE_MS);
        });
        if (get().loadGeneration !== generation) return;
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
        pageErrorRaw: 'unknown',
        pageErrorNodeSnapshot: snapshotNomadNodeForPageError(hash, liveNode),
      });
      return;
    }

    if (get().loadGeneration !== generation) return;

    if (!res.ok || !res.content) {
      const rawCode = res.error?.trim() || 'unknown';
      const liveNode = useNomadNetworkStore.getState().nodes.get(hash.toLowerCase());
      set({
        pageLoading: false,
        pageLoadingStartedAt: null,
        pageErrorRaw: rawCode,
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
      pageContent: text,
      pageContentType: res.content_type,
      pageContentTruncated: truncated,
      pageErrorRaw: null,
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
