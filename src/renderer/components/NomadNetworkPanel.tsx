import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Code,
  Eraser,
  FingerprintPattern,
  House,
  MoveHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCw,
  Search,
  Star,
  X,
} from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import {
  buildNomadLinkRequest,
  DEFAULT_NOMAD_NODE_PAGE_PATH,
  isNomadMicronPage,
  nomadPageRequestDataEquals,
  normalizeNomadPagePath,
  normalizeNomadPageRequestData,
  parseNomadNetworkLinkUrl,
} from '@/renderer/lib/nomad/micronParser';
import { downloadNomadFileFromBase64 } from '@/renderer/lib/nomad/nomadFileDownload';
import { clearNomadImageCache } from '@/renderer/lib/nomad/nomadImageCache';
import {
  type NomadListTab,
  nomadNetworkEmptyListKey,
  nomadNetworkSearchPlaceholderKey,
} from '@/renderer/lib/nomad/nomadNetworkTabHelpers';
import {
  defaultNomadNodeSortDir,
  type NomadNodeSortDir,
  type NomadNodeSortKey,
  prepareNomadNodeRows,
  readNomadNodeSortPreference,
  sortPreparedNomadNodeRows,
  writeNomadNodeSortPreference,
} from '@/renderer/lib/nomad/nomadNodeSort';
import { isNomadLastSeenStale } from '@/renderer/lib/nomad/nomadNodeStale';
import { clearNomadPageCache } from '@/renderer/lib/nomad/nomadPageCache';
import {
  humanizeNomadPageError,
  isRetryableNomadPageError,
  shouldForceNomadPathRefreshRetry,
} from '@/renderer/lib/nomad/nomadPageErrorHumanize';
import {
  readNomadPageFitWidth,
  writeNomadPageFitWidth,
} from '@/renderer/lib/nomad/nomadPageFitWidth';
import { nomadRasterDataUrl } from '@/renderer/lib/nomad/nomadRasterPreview';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadNodeRow, NomadPageRequestData } from '@/shared/nomad-types';

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import {
  formatNomadPageCountdown,
  formatNomadViewerUrlBar,
  type NomadPageErrorNodeSnapshot,
  nomadPageLoadingRemainingSec,
  type NomadPageLoadOptions,
  useNomadPageViewerStore,
} from '../stores/nomadPageViewerStore';
import { ConversationLayout, useConversationLayoutMode } from './chat/ConversationLayout';
import { ConfirmModal } from './ConfirmModal';
import NomadMicronPageView from './NomadMicronPageView';
import NomadPageServerPanel from './NomadPageServerPanel';
import { useToast } from './Toast';
import { IconButton } from './ui/Button';
import { INPUT_BOX_CLASS, INPUT_BOX_SM_CLASS } from './ui/formClasses';
import { SegmentedControl } from './ui/SegmentedControl';

interface NomadHistoryEntry {
  hash: string;
  path: string;
  requestData?: NomadPageRequestData;
}

const NOMAD_NODE_LIST_COLLAPSED_STORAGE_KEY = 'mesh-client:nomadNodeListCollapsed';

const NOMAD_SORT_KEYS: readonly NomadNodeSortKey[] = ['lastSeen', 'hops', 'name'];

function nomadSortLabelKey(key: NomadNodeSortKey): string {
  if (key === 'lastSeen') return 'nomadNetwork.sortLastHeard';
  if (key === 'hops') return 'nomadNetwork.sortHops';
  return 'nomadNetwork.sortName';
}

function nomadSortAriaLabelKey(key: NomadNodeSortKey, dir: NomadNodeSortDir): string {
  if (key === 'lastSeen') {
    return dir === 'asc' ? 'nomadNetwork.sortByLastHeardAsc' : 'nomadNetwork.sortByLastHeardDesc';
  }
  if (key === 'hops') {
    return dir === 'asc' ? 'nomadNetwork.sortByHopsAsc' : 'nomadNetwork.sortByHopsDesc';
  }
  return dir === 'asc' ? 'nomadNetwork.sortByNameAsc' : 'nomadNetwork.sortByNameDesc';
}

function formatNomadHash(hash: string): string {
  if (hash.length <= 16) return `<${hash}>`;
  return `<${hash.slice(0, 8)}…${hash.slice(-8)}>`;
}

function matchesSearch(node: NomadNodeRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (node.display_name ?? '').toLowerCase();
  const hash = node.destination_hash.toLowerCase();
  return name.includes(q) || hash.includes(q);
}

function nomadNodeChangedSincePageError(
  snap: NomadPageErrorNodeSnapshot,
  node: NomadNodeRow,
): boolean {
  return (node.last_seen ?? null) !== snap.lastSeen || (node.hops ?? null) !== snap.hops;
}

function NomadExpandedNodeItem({
  node,
  isSelected,
  openNodeLabel,
  toggleFavoriteLabel,
  onOpenNode,
  onToggleFavorite,
  formatHash,
  hopsAwayLabel,
  lastSeenLabel,
  identifyingLabel,
  stopIdentifyingLabel,
  onStopIdentifying,
}: {
  node: NomadNodeRow;
  isSelected: boolean;
  openNodeLabel: string;
  toggleFavoriteLabel: string;
  onOpenNode: (hash: string) => void;
  onToggleFavorite: (hash: string, favorited: boolean) => void;
  formatHash: (hash: string) => string;
  hopsAwayLabel: string | null;
  lastSeenLabel: string | null;
  identifyingLabel: string;
  stopIdentifyingLabel: string;
  onStopIdentifying: (hash: string) => void;
}) {
  const label = node.display_name ?? node.destination_hash.slice(0, 16);

  return (
    <li
      className={`rounded-card px-2 py-1.5 text-sm ${
        isSelected ? 'bg-sidebar-active-bg' : 'hover:bg-sidebar-active-bg/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-label={openNodeLabel}
          aria-current={isSelected ? 'page' : undefined}
          onClick={() => {
            onOpenNode(node.destination_hash);
          }}
        >
          <div
            className={`truncate font-medium ${isSelected ? 'text-bright-green' : 'text-ink-100'}`}
          >
            {label}
          </div>
          <div className="text-muted truncate font-mono text-xs">
            {formatHash(node.destination_hash)}
          </div>
          <div className="text-muted mt-1 flex flex-wrap gap-x-2 text-xs">
            {hopsAwayLabel ? <span>{hopsAwayLabel}</span> : null}
            {lastSeenLabel ? <span>{lastSeenLabel}</span> : null}
          </div>
        </button>
        {node.identify === true ? (
          <button
            type="button"
            className="text-bright-green hover:bg-ink-800 rounded-control inline-flex shrink-0 items-center gap-1 px-1 py-0.5 text-xs"
            aria-label={stopIdentifyingLabel}
            title={stopIdentifyingLabel}
            onClick={(e) => {
              e.stopPropagation();
              onStopIdentifying(node.destination_hash);
            }}
          >
            <FingerprintPattern aria-hidden className="h-3.5 w-3.5" />
            <span>{identifyingLabel}</span>
          </button>
        ) : null}
        <button
          type="button"
          className={`rounded-control shrink-0 p-1 ${node.favorited ? 'text-yellow-400' : 'text-muted hover:text-ink-200'}`}
          aria-label={toggleFavoriteLabel}
          aria-pressed={node.favorited}
          onClick={() => {
            onToggleFavorite(node.destination_hash, !node.favorited);
          }}
        >
          <Star aria-hidden className="h-4 w-4" fill={node.favorited ? 'currentColor' : 'none'} />
        </button>
      </div>
    </li>
  );
}

export default function NomadNetworkPanel({
  onOpenDm,
  isActive = true,
}: {
  onOpenDm?: (destinationHash: string) => void;
  isActive?: boolean;
}) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const nodes = useNomadNetworkStore((s) => s.nodes);
  const lastRefreshAt = useNomadNetworkStore((s) => s.lastRefreshAt);
  const nomadApiAvailable = useNomadNetworkStore((s) => s.nomadApiAvailable);
  const refreshFromSidecar = useNomadNetworkStore((s) => s.refreshFromSidecar);
  const fetchNomadPage = useNomadNetworkStore((s) => s.fetchNomadPage);
  const fetchNomadFile = useNomadNetworkStore((s) => s.fetchNomadFile);
  const fetchNomadMedia = useNomadNetworkStore((s) => s.fetchNomadMedia);
  const toggleFavorite = useNomadNetworkStore((s) => s.toggleFavorite);
  const setIdentify = useNomadNetworkStore((s) => s.setIdentify);
  const clearAllIdentify = useNomadNetworkStore((s) => s.clearAllIdentify);

  const selectedHash = useNomadPageViewerStore((s) => s.selectedHash);
  const pagePath = useNomadPageViewerStore((s) => s.pagePath);
  const pageRequestData = useNomadPageViewerStore((s) => s.pageRequestData);
  const pageContent = useNomadPageViewerStore((s) => s.pageContent);
  const pageContentType = useNomadPageViewerStore((s) => s.pageContentType);
  const pageContentTruncated = useNomadPageViewerStore((s) => s.pageContentTruncated);
  const pageLoading = useNomadPageViewerStore((s) => s.pageLoading);
  const pageLoadingStartedAt = useNomadPageViewerStore((s) => s.pageLoadingStartedAt);
  const pageLoadingBudgetSec = useNomadPageViewerStore((s) => s.pageLoadingBudgetSec);
  const pageLoadingRetrying = useNomadPageViewerStore((s) => s.pageLoadingRetrying);
  const pageLoadingProgress = useNomadPageViewerStore((s) => s.pageLoadingProgress);
  const pageErrorRaw = useNomadPageViewerStore((s) => s.pageErrorRaw);
  const pageErrorEgress = useNomadPageViewerStore((s) => s.pageErrorEgress);
  const pageErrorDiag = useNomadPageViewerStore((s) => s.pageErrorDiag);
  const pageErrorNodeSnapshot = useNomadPageViewerStore((s) => s.pageErrorNodeSnapshot);
  const announceReloadDone = useNomadPageViewerStore((s) => s.announceReloadDone);
  const loadPage = useNomadPageViewerStore((s) => s.loadPage);
  const closeViewerStore = useNomadPageViewerStore((s) => s.closeViewer);
  const setPanelActive = useNomadPageViewerStore((s) => s.setPanelActive);
  const setInvalidUrlError = useNomadPageViewerStore((s) => s.setInvalidUrlError);
  const markAnnounceReloadDone = useNomadPageViewerStore((s) => s.markAnnounceReloadDone);

  const pageError = pageErrorRaw ? humanizeNomadPageError(pageErrorRaw, t, pageErrorDiag) : null;
  const pageErrorCode = pageErrorRaw;

  const [activeTab, setActiveTab] = useState<NomadListTab>('favourites');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [urlBarValue, setUrlBarValue] = useState('');
  const [historyStack, setHistoryStack] = useState<NomadHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showPageSource, setShowPageSource] = useState(false);
  const [pageLoadingRemainingSec, setPageLoadingRemainingSec] = useState(0);
  const [fileDownloading, setFileDownloading] = useState(false);
  const [fileDownloadError, setFileDownloadError] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<{
    fileName: string;
    dataUrl: string;
    contentBase64: string;
  } | null>(null);
  const [nodeListCollapsed, setNodeListCollapsed] = useState(
    () => localStorage.getItem(NOMAD_NODE_LIST_COLLAPSED_STORAGE_KEY) === 'true',
  );
  const [pageFitWidth, setPageFitWidth] = useState(readNomadPageFitWidth);
  const [pendingIdentifyConfirm, setPendingIdentifyConfirm] = useState<{
    hash: string;
    name: string;
  } | null>(null);
  const [pendingClearAllIdentify, setPendingClearAllIdentify] = useState(false);
  const [sortPref, setSortPref] = useState(readNomadNodeSortPreference);
  const sortKey = sortPref.key;
  const sortDir = sortPref.dir;
  const fileDownloadInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const historyIndexRef = useRef(-1);
  const layoutMode = useConversationLayoutMode();
  const [compactPane, setCompactPane] = useState<'list' | 'conversation'>(
    selectedHash ? 'conversation' : 'list',
  );
  const listToggleRef = useRef<HTMLButtonElement>(null);
  const viewerToggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const viewerHeaderRef = useRef<HTMLElement>(null);
  const movePaneFocus = useRef(false);
  const compactModeRef = useRef(layoutMode.compact);

  useEffect(() => {
    if (compactModeRef.current !== layoutMode.compact) {
      compactModeRef.current = layoutMode.compact;
      movePaneFocus.current = true;
    }
    if (!isActive || !movePaneFocus.current) return;
    movePaneFocus.current = false;
    const listVisible = layoutMode.compact ? compactPane === 'list' : !nodeListCollapsed;
    if (listVisible) {
      (
        listToggleRef.current ??
        listRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      )?.focus();
    } else {
      (viewerToggleRef.current ?? viewerHeaderRef.current)?.focus();
    }
  }, [compactPane, isActive, layoutMode.compact, nodeListCollapsed]);

  useEffect(
    () =>
      useNomadPageViewerStore.subscribe((next, previous) => {
        if (next.loadGeneration === previous.loadGeneration || !next.selectedHash) return;
        setActiveTab((tab) => (tab === 'myPages' ? 'announces' : tab));
        if (compactModeRef.current) movePaneFocus.current = true;
        setCompactPane('conversation');
      }),
    [],
  );

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    setPanelActive(isActive);
    return () => {
      setPanelActive(false);
    };
  }, [isActive, setPanelActive]);

  useEffect(() => {
    if (!pageLoading || pageLoadingStartedAt == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear countdown when load ends
      setPageLoadingRemainingSec(0);
      return;
    }
    const tick = () => {
      setPageLoadingRemainingSec(
        nomadPageLoadingRemainingSec(pageLoadingStartedAt, pageLoadingBudgetSec),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [pageLoading, pageLoadingStartedAt, pageLoadingBudgetSec]);

  useEffect(() => {
    if (selectedHash) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror store navigation into the editable URL bar
      setUrlBarValue(formatNomadViewerUrlBar(selectedHash, pagePath, pageRequestData));
    }
  }, [selectedHash, pagePath, pageRequestData]);

  useEffect(() => {
    if (isActive && selectedHash == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset list tab when panel becomes visible without a page open
      setActiveTab('favourites');
    }
  }, [isActive, selectedHash]);

  const pushHistoryEntry = useCallback(
    (hash: string, path: string, requestData?: NomadPageRequestData) => {
      const normalizedPath = normalizeNomadPagePath(path);
      const normalizedRequest = normalizeNomadPageRequestData(requestData);
      setHistoryStack((prev) => {
        const idx = historyIndexRef.current;
        const last = prev[idx];
        if (
          last?.hash.toLowerCase() === hash.toLowerCase() &&
          last.path === normalizedPath &&
          nomadPageRequestDataEquals(last.requestData, normalizedRequest)
        ) {
          return prev;
        }
        const truncated = prev.slice(0, idx + 1);
        const next = [...truncated, { hash, path: normalizedPath, requestData: normalizedRequest }];
        const nextIndex = next.length - 1;
        historyIndexRef.current = nextIndex;
        setHistoryIndex(nextIndex);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Keep in-flight Nomad loads alive across protocol/panel unmount.
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const applyRunning = (running: boolean) => {
      setSidecarRunning(running);
      // floating-ok: refreshFromSidecar (store) catches/logs; Nomad refreshFromSidecar same pattern
      if (running) void refreshFromSidecar();
    };
    void isReticulumSidecarRunning()
      .then(applyRunning)
      .catch((e: unknown) => {
        console.warn('[NomadNetworkPanel] sidecar status ' + errLikeToLogString(e));
      });
    const unsub = window.electronAPI.reticulum.onStatus((status) => {
      applyRunning(status.running && status.port > 0);
    });
    return unsub;
  }, [refreshFromSidecar]);

  const allRows = useMemo(() => [...nodes.values()], [nodes]);

  const tabRows = useMemo(() => {
    if (activeTab === 'myPages') {
      return [];
    }
    if (activeTab === 'favourites') {
      return allRows.filter((node) => node.favorited);
    }
    return allRows;
  }, [activeTab, allRows]);

  const filteredRows = useMemo(
    () => tabRows.filter((node) => matchesSearch(node, searchQuery)),
    [tabRows, searchQuery],
  );

  const sortedRows = useMemo(() => {
    const prepared = prepareNomadNodeRows(filteredRows);
    return sortPreparedNomadNodeRows(prepared, sortKey, sortDir).map((row) => row.node);
  }, [filteredRows, sortDir, sortKey]);

  const favouritesCount = useMemo(() => allRows.filter((node) => node.favorited).length, [allRows]);

  const identifyingCount = useMemo(
    () => allRows.filter((node) => node.identify === true).length,
    [allRows],
  );

  const selectedNode = selectedHash ? nodes.get(selectedHash.toLowerCase()) : undefined;
  const selectedIdentifying = selectedNode?.identify === true;

  const loadNodePage = useCallback(
    async (hash: string, path: string, options: NomadPageLoadOptions = {}) => {
      setShowPageSource(false);
      const normalizedPath = normalizeNomadPagePath(path);
      const normalizedRequest = normalizeNomadPageRequestData(options.requestData);
      await loadPage(hash, path, options);
      const viewer = useNomadPageViewerStore.getState();
      if (
        !options.fromHistory &&
        viewer.pageContent != null &&
        viewer.selectedHash?.toLowerCase() === hash.toLowerCase() &&
        viewer.pagePath === normalizedPath
      ) {
        pushHistoryEntry(hash, normalizedPath, normalizedRequest);
      }
    },
    [loadPage, pushHistoryEntry],
  );

  useEffect(() => {
    if (
      pageLoading ||
      !pageErrorCode ||
      !isRetryableNomadPageError(pageErrorCode) ||
      !selectedHash ||
      !selectedNode
    ) {
      return;
    }
    if (announceReloadDone) return;
    const snap = pageErrorNodeSnapshot;
    if (snap == null) return;
    if (snap.hash !== selectedHash.toLowerCase()) return;
    if (!nomadNodeChangedSincePageError(snap, selectedNode)) return;

    markAnnounceReloadDone();
    console.warn('[NomadNetwork] page reload after announce refresh');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-retry after announce updates node metadata
    void loadNodePage(selectedHash, pagePath, {
      forceReload: true,
      forcePathRefresh: shouldForceNomadPathRefreshRetry(pageErrorCode, pageErrorEgress),
      requestData: pageRequestData,
    });
  }, [
    announceReloadDone,
    loadNodePage,
    markAnnounceReloadDone,
    pageErrorCode,
    pageErrorEgress,
    pageErrorNodeSnapshot,
    pageLoading,
    pagePath,
    pageRequestData,
    selectedHash,
    selectedNode,
    selectedNode?.hops,
    selectedNode?.last_seen,
  ]);

  const downloadNodeFile = useCallback(
    async (hash: string, path: string) => {
      if (fileDownloadInFlightRef.current) {
        setFileDownloadError(t('nomadNetwork.fileDownloadInProgress'));
        return;
      }
      fileDownloadInFlightRef.current = true;
      setFileDownloading(true);
      setFileDownloadError(null);
      setFilePreview(null);
      try {
        const normalizedPath = normalizeNomadPagePath(path);
        const res = await fetchNomadFile(hash, normalizedPath);
        if (!mountedRef.current) return;
        if (!res.ok || !res.content_base64) {
          setFileDownloadError(humanizeNomadPageError(res.error, t));
          return;
        }
        const fileName = res.file_name ?? normalizedPath.split('/').pop() ?? 'downloaded_file';
        const dataUrl = nomadRasterDataUrl(fileName, res.content_base64);
        if (dataUrl) {
          setFilePreview({ fileName, dataUrl, contentBase64: res.content_base64 });
        } else {
          downloadNomadFileFromBase64(fileName, res.content_base64);
        }
      } catch (e) {
        // Failure point: unexpected fetchNomadFile reject. Fallback: humanize if possible.
        if (!mountedRef.current) return;
        console.warn('[NomadNetworkPanel] file download ' + errLikeToLogString(e));
        setFileDownloadError(humanizeNomadPageError(undefined, t));
      } finally {
        if (mountedRef.current) {
          fileDownloadInFlightRef.current = false;
          setFileDownloading(false);
        } else {
          fileDownloadInFlightRef.current = false;
        }
      }
    },
    [fetchNomadFile, t],
  );

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyStack.length - 1;

  const navigateHistory = useCallback(
    (delta: -1 | 1) => {
      const targetIndex = historyIndex + delta;
      const entry = historyStack[targetIndex];
      if (!entry) return;
      historyIndexRef.current = targetIndex;
      setHistoryIndex(targetIndex);
      void loadNodePage(entry.hash, entry.path, {
        fromHistory: true,
        requestData: entry.requestData,
      });
    },
    [historyIndex, historyStack, loadNodePage],
  );

  const activeDestinationHash = selectedNode?.destination_hash ?? selectedHash;

  const submitUrlBar = useCallback(() => {
    const trimmed = urlBarValue.trim();
    if (!trimmed) return;

    let target = trimmed;
    if (target.startsWith(':')) {
      if (!activeDestinationHash) {
        setInvalidUrlError();
        return;
      }
      target = `${activeDestinationHash}${target}`;
    }

    const { destination: baseDestination, requestData } = buildNomadLinkRequest(target, null, null);
    const parsed = parseNomadNetworkLinkUrl(baseDestination, DEFAULT_NOMAD_NODE_PAGE_PATH);
    if (!parsed) {
      setInvalidUrlError();
      return;
    }

    const hash = parsed.destination_hash ?? activeDestinationHash;
    if (!hash) {
      setInvalidUrlError();
      return;
    }
    const normalizedRequest = normalizeNomadPageRequestData(requestData);
    void loadNodePage(hash, parsed.path, {
      requestData: normalizedRequest,
    });
  }, [activeDestinationHash, loadNodePage, setInvalidUrlError, urlBarValue]);

  const closeViewer = useCallback(() => {
    closeViewerStore();
    setUrlBarValue('');
    setHistoryStack([]);
    historyIndexRef.current = -1;
    setHistoryIndex(-1);
    setActiveTab('favourites');
  }, [closeViewerStore]);

  const clearBrowserCaches = useCallback(() => {
    clearNomadPageCache();
    clearNomadImageCache();
    addToast(t('nomadNetwork.clearedBrowserCaches'), 'success');
  }, [addToast, t]);

  const handleNodeListToggle = useCallback(() => {
    movePaneFocus.current = true;
    setNodeListCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NOMAD_NODE_LIST_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const toggleSort = useCallback((key: NomadNodeSortKey) => {
    setSortPref((prev) => {
      const nextDir: NomadNodeSortDir = prev.dir === 'asc' ? 'desc' : 'asc';
      const next =
        prev.key === key ? { key, dir: nextDir } : { key, dir: defaultNomadNodeSortDir(key) };
      writeNomadNodeSortPreference(next);
      return next;
    });
  }, []);

  const handleOpenNode = useCallback(
    (hash: string) => {
      void loadNodePage(hash, DEFAULT_NOMAD_NODE_PAGE_PATH);
    },
    [loadNodePage],
  );

  const handlePreviewHostedSite = useCallback(
    (hash: string) => {
      setActiveTab('announces');
      void (async () => {
        try {
          await refreshFromSidecar();
          if (!mountedRef.current) return;
          void loadNodePage(hash, DEFAULT_NOMAD_NODE_PAGE_PATH, { forceReload: true });
        } catch (e) {
          // catch-no-log-ok surfaced via page error when load fails; refresh failure is non-fatal
          console.warn('[NomadNetwork] preview hosted site refresh failed:', e);
        }
      })();
    },
    [loadNodePage, refreshFromSidecar],
  );

  const handleToggleFavorite = useCallback(
    (hash: string, favorited: boolean) => {
      void toggleFavorite(hash, favorited);
    },
    [toggleFavorite],
  );

  const nodeLabel = useCallback(
    (hash: string) => {
      const node = nodes.get(hash.toLowerCase());
      return node?.display_name ?? hash.slice(0, 16);
    },
    [nodes],
  );

  const reloadIfViewing = useCallback(
    (hashes: readonly string[]) => {
      const viewer = useNomadPageViewerStore.getState();
      const open = viewer.selectedHash?.toLowerCase();
      if (!open || !hashes.some((h) => h.toLowerCase() === open)) return;
      void loadNodePage(viewer.selectedHash ?? open, viewer.pagePath, {
        forceReload: true,
        requestData: viewer.pageRequestData,
      });
    },
    [loadNodePage],
  );

  const applyIdentify = useCallback(
    async (hash: string, identify: boolean) => {
      const name = nodeLabel(hash);
      const saved = await setIdentify(hash, identify);
      if (!mountedRef.current) return;
      if (!saved) {
        addToast(t('nomadNetwork.identifyFailedToast', { name }), 'error');
        return;
      }
      addToast(
        identify
          ? t('nomadNetwork.identifyEnabledToast', { name })
          : t('nomadNetwork.identifyDisabledToast', { name }),
        identify ? 'success' : 'info',
      );
      reloadIfViewing([hash]);
    },
    [addToast, nodeLabel, reloadIfViewing, setIdentify, t],
  );

  const handleIdentifyToggle = useCallback(() => {
    if (!selectedNode) return;
    const hash = selectedNode.destination_hash;
    if (selectedIdentifying) {
      void applyIdentify(hash, false);
      return;
    }
    setPendingIdentifyConfirm({ hash, name: nodeLabel(hash) });
  }, [applyIdentify, nodeLabel, selectedIdentifying, selectedNode, setPendingIdentifyConfirm]);

  const handleStopIdentifying = useCallback(
    (hash: string) => {
      void applyIdentify(hash, false);
    },
    [applyIdentify],
  );

  const confirmClearAllIdentify = useCallback(async () => {
    setPendingClearAllIdentify(false);
    const affected = allRows
      .filter((node) => node.identify === true)
      .map((node) => node.destination_hash);
    const cleared = await clearAllIdentify();
    if (!mountedRef.current) return;
    if (cleared == null) {
      addToast(t('nomadNetwork.identifyClearAllFailedToast'), 'error');
      return;
    }
    addToast(t('nomadNetwork.identifyClearedAllToast', { count: cleared }), 'info');
    reloadIfViewing(affected);
  }, [addToast, allRows, clearAllIdentify, reloadIfViewing, setPendingClearAllIdentify, t]);

  const handleMicronNavigate = useCallback(
    (hash: string, path: string, requestData?: NomadPageRequestData) => {
      void loadNodePage(hash, path, { requestData });
    },
    [loadNodePage],
  );

  const handleMicronDownload = useCallback(
    (hash: string, path: string) => {
      void downloadNodeFile(hash, path);
    },
    [downloadNodeFile],
  );

  const searchPlaceholder = t(nomadNetworkSearchPlaceholderKey(activeTab), {
    count: activeTab === 'favourites' ? favouritesCount : allRows.length,
  });

  const emptyKey = nomadNetworkEmptyListKey(activeTab);

  const showStartStackBanner = !sidecarRunning && lastRefreshAt == null && allRows.length === 0;

  const renderNodeListBody = () => {
    if (activeTab === 'myPages') {
      return <p className="text-muted px-3 pb-3 text-sm">{t('nomadNetwork.serving.title')}</p>;
    }
    if (filteredRows.length === 0) {
      return <p className="text-muted px-3 pb-3 text-sm">{t(emptyKey)}</p>;
    }
    return sortedRows.map((node) => {
      const isSelected = selectedHash?.toLowerCase() === node.destination_hash.toLowerCase();
      const label = node.display_name ?? node.destination_hash.slice(0, 16);
      const openNodeLabel = t('nomadNetwork.openNode', { name: label });

      return (
        <NomadExpandedNodeItem
          key={node.destination_hash}
          node={node}
          isSelected={isSelected}
          openNodeLabel={openNodeLabel}
          toggleFavoriteLabel={t('nomadNetwork.toggleFavorite')}
          onOpenNode={handleOpenNode}
          onToggleFavorite={handleToggleFavorite}
          formatHash={formatNomadHash}
          identifyingLabel={t('nomadNetwork.identifyingBadge')}
          stopIdentifyingLabel={t('nomadNetwork.identifyStopAria', { name: label })}
          onStopIdentifying={handleStopIdentifying}
          hopsAwayLabel={
            node.hops != null ? t('nomadNetwork.hopsAway', { count: node.hops }) : null
          }
          lastSeenLabel={
            node.last_seen
              ? t('nomadNetwork.lastSeen', {
                  time: formatRelativeOrIsoDate(node.last_seen * 1000, t),
                })
              : null
          }
        />
      );
    });
  };

  const chooseListTab = (tab: NomadListTab) => {
    setActiveTab(tab);
    if (layoutMode.compact && tab === 'myPages') {
      movePaneFocus.current = true;
      setCompactPane('conversation');
    }
  };

  const listColumn = (
    <div ref={listRef} className="flex min-h-0 flex-1 flex-col">
      <div className="border-ink-800 flex min-h-14 shrink-0 items-center gap-1.5 border-b pr-2 pl-3">
        <h2 className="text-ink-100 min-w-0 flex-1 text-sm font-semibold">
          {t('nomadNetwork.title')}
        </h2>
        <IconButton
          size="sm"
          aria-label={t('common.refresh')}
          onClick={() => void refreshFromSidecar()}
          icon={<RefreshCw aria-hidden size={14} />}
        />
        {layoutMode.compact ? (
          <IconButton
            size="sm"
            aria-label={t('nomadNetwork.showBrowser')}
            onClick={() => {
              movePaneFocus.current = true;
              setCompactPane('conversation');
            }}
            icon={<PanelLeftClose aria-hidden trigger="manual" size={16} />}
          />
        ) : (
          <IconButton
            ref={listToggleRef}
            size="sm"
            aria-label={t('nomadNetwork.collapseNodeList')}
            aria-expanded
            onClick={handleNodeListToggle}
            icon={<PanelLeftClose aria-hidden trigger="manual" size={16} />}
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <SegmentedControl
          aria-label={t('nomadNetwork.title')}
          value={activeTab}
          onChange={chooseListTab}
          className="w-full flex-wrap"
          options={[
            { value: 'favourites', label: t('nomadNetwork.favourites') },
            { value: 'announces', label: t('nomadNetwork.announces') },
            { value: 'myPages', label: t('nomadNetwork.myPagesTab') },
          ]}
        />
        {identifyingCount > 0 ? (
          <button
            type="button"
            disabled={!sidecarRunning}
            className="text-bright-green hover:bg-ink-800 rounded-control inline-flex items-center gap-1 self-start px-1 py-0.5 text-xs disabled:opacity-40"
            aria-label={t('nomadNetwork.identifyClearAllAria', { count: identifyingCount })}
            title={t('nomadNetwork.identifyClearAllAria', { count: identifyingCount })}
            onClick={() => {
              setPendingClearAllIdentify(true);
            }}
          >
            <FingerprintPattern aria-hidden className="h-3.5 w-3.5" />
            <span>{t('nomadNetwork.identifyClearAll')}</span>
          </button>
        ) : null}
        {activeTab !== 'myPages' && (
          <>
            <div className="relative">
              <Search
                aria-hidden
                size={14}
                className="text-muted pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                }}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className={`${INPUT_BOX_CLASS} w-full pl-8`}
              />
            </div>
            <div
              role="toolbar"
              aria-label={t('nomadNetwork.sortToolbar')}
              className="flex flex-wrap items-center gap-1 text-xs"
            >
              {NOMAD_SORT_KEYS.map((key) => {
                const active = sortKey === key;
                const dirForAria = active ? sortDir : defaultNomadNodeSortDir(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    aria-label={t(nomadSortAriaLabelKey(key, dirForAria))}
                    className={`rounded-control inline-flex items-center gap-1 px-2 py-1 transition-colors ${active ? 'bg-sidebar-active-bg text-ink-100' : 'text-muted hover:text-ink-200'}`}
                    onClick={() => {
                      toggleSort(key);
                    }}
                  >
                    {t(nomadSortLabelKey(key))}
                    {active &&
                      (sortDir === 'asc' ? (
                        <ChevronUp aria-hidden size={14} />
                      ) : (
                        <ChevronDown aria-hidden size={14} />
                      ))}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {activeTab === 'myPages' || filteredRows.length === 0 ? (
          renderNodeListBody()
        ) : (
          <ul className="space-y-0.5">{renderNodeListBody()}</ul>
        )}
      </div>
    </div>
  );

  const viewer = (
    <>
      <header
        ref={viewerHeaderRef}
        tabIndex={-1}
        className="border-ink-800 flex min-h-14 shrink-0 items-center gap-2 border-b px-3 py-2 outline-none"
      >
        {(layoutMode.compact || nodeListCollapsed) && (
          <IconButton
            ref={viewerToggleRef}
            aria-label={t('nomadNetwork.expandNodeList')}
            aria-expanded={false}
            onClick={() => {
              if (layoutMode.compact) {
                movePaneFocus.current = true;
                setCompactPane('list');
              } else handleNodeListToggle();
            }}
            icon={
              layoutMode.compact ? (
                <ChevronLeft aria-hidden trigger="manual" size={16} />
              ) : (
                <PanelLeftOpen aria-hidden trigger="manual" size={16} />
              )
            }
          />
        )}
        <h2 className="text-ink-100 min-w-0 flex-1 truncate text-sm font-semibold">
          {activeTab === 'myPages' ? t('nomadNetwork.myPagesTab') : t('nomadNetwork.title')}
        </h2>
        {(layoutMode.compact || nodeListCollapsed) && (
          <IconButton
            size="sm"
            aria-label={t('common.refresh')}
            onClick={() => void refreshFromSidecar()}
            icon={<RefreshCw aria-hidden size={14} />}
          />
        )}
      </header>
      {activeTab === 'myPages' ? (
        <NomadPageServerPanel isActive={isActive} onPreviewHostedSite={handlePreviewHostedSite} />
      ) : null}
      {activeTab !== 'myPages' && !selectedHash ? (
        <div className="m-auto flex w-full max-w-lg flex-col items-stretch gap-3 p-6">
          <p className="text-muted text-center text-sm">{t('nomadNetwork.enterUrlHint')}</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitUrlBar();
            }}
          >
            <input
              type="text"
              value={urlBarValue}
              onChange={(e) => {
                setUrlBarValue(e.target.value);
              }}
              aria-label={t('nomadNetwork.urlBarAria')}
              placeholder={t('nomadNetwork.enterUrlPlaceholder')}
              className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1 font-mono`}
            />
            <button
              type="submit"
              className="border-ink-600 text-ink-200 hover:bg-ink-800 shrink-0 rounded border px-3 py-1.5 text-xs"
              aria-label={t('nomadNetwork.goToUrl')}
            >
              {t('nomadNetwork.goToUrl')}
            </button>
          </form>
          {pageError ? (
            <p className="text-center text-sm text-red-300">
              {t('nomadNetwork.pageFailed', { error: pageError })}
            </p>
          ) : null}
        </div>
      ) : null}
      {activeTab !== 'myPages' && selectedHash ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-ink-700/60 flex shrink-0 flex-wrap items-center gap-2 border-b p-2">
            <span className="text-ink-100 truncate font-medium">
              {selectedNode?.display_name ?? selectedHash.slice(0, 16)}
            </span>
            {selectedNode?.hops != null ? (
              <span className="text-muted text-xs">
                {t('nomadNetwork.hopsAway', { count: selectedNode.hops })}
              </span>
            ) : null}
            <div className="ml-auto flex flex-wrap gap-1">
              {onOpenDm && selectedNode ? (
                <button
                  type="button"
                  disabled={!sidecarRunning}
                  className="rounded border border-purple-600 px-2 py-1 text-xs text-purple-300 hover:bg-purple-900/30 disabled:opacity-40"
                  aria-label={t('nomadNetwork.sendMessageAria', {
                    name: selectedNode.display_name ?? selectedNode.destination_hash.slice(0, 16),
                  })}
                  title={t('nomadNetwork.sendMessageAria', {
                    name: selectedNode.display_name ?? selectedNode.destination_hash.slice(0, 16),
                  })}
                  onClick={() => {
                    onOpenDm(selectedNode.destination_hash);
                  }}
                >
                  {t('nomadNetwork.sendMessage')}
                </button>
              ) : null}
              {selectedNode ? (
                <button
                  type="button"
                  disabled={!sidecarRunning}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40 ${
                    selectedIdentifying
                      ? 'border-bright-green/60 bg-bright-green/20 text-bright-green'
                      : 'border-ink-700 text-ink-200 hover:bg-ink-800'
                  }`}
                  aria-label={
                    selectedIdentifying
                      ? t('nomadNetwork.identifyStopAria', {
                          name: nodeLabel(selectedNode.destination_hash),
                        })
                      : t('nomadNetwork.identifyEnableAria', {
                          name: nodeLabel(selectedNode.destination_hash),
                        })
                  }
                  title={
                    sidecarRunning
                      ? selectedIdentifying
                        ? t('nomadNetwork.identifyOnHint')
                        : t('nomadNetwork.identifyOffHint')
                      : t('nomadNetwork.identifyUnavailable')
                  }
                  aria-pressed={selectedIdentifying}
                  onClick={handleIdentifyToggle}
                >
                  <FingerprintPattern aria-hidden className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                disabled={!canGoBack}
                className="border-ink-700 text-ink-200 hover:bg-ink-800 inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40"
                aria-label={t('nomadNetwork.back')}
                title={t('nomadNetwork.back')}
                onClick={() => {
                  navigateHistory(-1);
                }}
              >
                <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={!canGoForward}
                className="border-ink-700 text-ink-200 hover:bg-ink-800 inline-flex h-7 w-7 items-center justify-center rounded-md border disabled:opacity-40"
                aria-label={t('nomadNetwork.forward')}
                title={t('nomadNetwork.forward')}
                onClick={() => {
                  navigateHistory(1);
                }}
              >
                <ArrowRight aria-hidden className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="border-ink-700 text-ink-200 hover:bg-ink-800 inline-flex h-7 w-7 items-center justify-center rounded-md border"
                aria-label={t('nomadNetwork.homePage')}
                title={t('nomadNetwork.homePage')}
                onClick={() => {
                  void loadNodePage(selectedHash, DEFAULT_NOMAD_NODE_PAGE_PATH);
                }}
              >
                <House aria-hidden className="h-3.5 w-3.5" />
              </button>
              {isNomadMicronPage(pageContentType, pagePath) && pageContent != null ? (
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${
                    showPageSource
                      ? 'border-bright-green/60 bg-bright-green/20 text-bright-green'
                      : 'border-ink-700 text-ink-200 hover:bg-ink-800'
                  }`}
                  aria-label={
                    showPageSource ? t('nomadNetwork.hideSource') : t('nomadNetwork.showSource')
                  }
                  title={
                    showPageSource ? t('nomadNetwork.hideSource') : t('nomadNetwork.showSource')
                  }
                  aria-pressed={showPageSource}
                  onClick={() => {
                    setShowPageSource((prev) => !prev);
                  }}
                >
                  <Code aria-hidden className="h-3.5 w-3.5" />
                </button>
              ) : null}
              {pageContent != null ? (
                <button
                  type="button"
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${
                    pageFitWidth
                      ? 'border-bright-green/60 bg-bright-green/20 text-bright-green'
                      : 'border-ink-700 text-ink-200 hover:bg-ink-800'
                  }`}
                  aria-label={
                    pageFitWidth ? t('nomadNetwork.openWidth') : t('nomadNetwork.fitWidth')
                  }
                  title={pageFitWidth ? t('nomadNetwork.openWidth') : t('nomadNetwork.fitWidth')}
                  aria-pressed={pageFitWidth}
                  onClick={() => {
                    setPageFitWidth((prev) => {
                      const next = !prev;
                      writeNomadPageFitWidth(next);
                      return next;
                    });
                  }}
                >
                  <MoveHorizontal aria-hidden className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                type="button"
                className="border-ink-700 text-ink-200 hover:bg-ink-800 inline-flex h-7 w-7 items-center justify-center rounded-md border"
                aria-label={t('nomadNetwork.reloadPage')}
                title={t('nomadNetwork.reloadPage')}
                onClick={() => {
                  void loadNodePage(selectedHash, pagePath, {
                    forceReload: true,
                    forcePathRefresh: shouldForceNomadPathRefreshRetry(
                      pageErrorCode,
                      pageErrorEgress,
                    ),
                    requestData: pageRequestData,
                  });
                }}
              >
                <RotateCw aria-hidden className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="border-ink-700 text-ink-200 hover:bg-ink-800 inline-flex h-7 w-7 items-center justify-center rounded-md border"
                aria-label={t('nomadNetwork.clearBrowserCaches')}
                title={t('nomadNetwork.clearBrowserCachesHint')}
                onClick={clearBrowserCaches}
              >
                <Eraser aria-hidden className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="border-ink-700 text-ink-200 hover:bg-ink-800 inline-flex h-7 w-7 items-center justify-center rounded-md border"
                aria-label={t('nomadNetwork.closeViewer')}
                title={t('nomadNetwork.closeViewer')}
                onClick={closeViewer}
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <form
            className="border-ink-700/60 flex shrink-0 gap-2 border-b p-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitUrlBar();
            }}
          >
            <input
              type="text"
              value={urlBarValue}
              onChange={(e) => {
                setUrlBarValue(e.target.value);
              }}
              aria-label={t('nomadNetwork.urlBarAria')}
              placeholder={t('nomadNetwork.pagePath')}
              className={`${INPUT_BOX_SM_CLASS} min-w-0 flex-1 font-mono`}
            />
          </form>

          <div className="relative min-h-0 min-w-0 flex-1">
            <div
              data-testid="nomad-page-scroll"
              className="nomad-page-scroll bg-deep-black/50 h-full min-h-0 min-w-0 overflow-auto overscroll-contain p-3 [overflow-anchor:none]"
            >
              {fileDownloading ? (
                <p className="text-muted mb-2 text-sm">{t('nomadNetwork.fileDownloading')}</p>
              ) : null}
              {fileDownloadError ? (
                <p className="mb-2 text-sm text-red-300">
                  {t('nomadNetwork.fileDownloadFailed', { error: fileDownloadError })}
                </p>
              ) : null}
              {filePreview ? (
                <div className="border-ink-700/80 bg-ink-900/50 mb-3 space-y-2 rounded border p-2">
                  <p className="text-muted text-xs">{filePreview.fileName}</p>
                  <img
                    src={filePreview.dataUrl}
                    alt={filePreview.fileName}
                    className="max-h-[50vh] max-w-full object-contain"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        downloadNomadFileFromBase64(
                          filePreview.fileName,
                          filePreview.contentBase64,
                        );
                      }}
                    >
                      {t('nomadNetwork.downloadFile', { defaultValue: 'Download' })}
                    </button>
                    <button
                      type="button"
                      className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs"
                      onClick={() => {
                        setFilePreview(null);
                      }}
                    >
                      {t('nomadNetwork.dismissPreview', { defaultValue: 'Dismiss' })}
                    </button>
                  </div>
                </div>
              ) : null}
              {pageLoading ? (
                <div className="space-y-1">
                  <p className="text-muted text-sm">
                    {pageLoadingProgress
                      ? t(pageLoadingProgress.messageKey, pageLoadingProgress.messageParams)
                      : pageLoadingStartedAt == null
                        ? t('nomadNetwork.pageLoading')
                        : pageLoadingRetrying
                          ? pageLoadingRemainingSec > 0
                            ? t('nomadNetwork.pageLoadingRetryCountdown', {
                                time: formatNomadPageCountdown(pageLoadingRemainingSec),
                              })
                            : t('nomadNetwork.pageLoadingRetryOverdue')
                          : pageLoadingRemainingSec > 0
                            ? t('nomadNetwork.pageLoadingCountdown', {
                                time: formatNomadPageCountdown(pageLoadingRemainingSec),
                              })
                            : t('nomadNetwork.pageLoadingCountdownOverdue')}
                  </p>
                  {pageLoadingProgress && pageLoadingStartedAt != null ? (
                    <p className="text-muted text-xs">
                      {pageLoadingRemainingSec > 0
                        ? t('nomadNetwork.pageLoadingTimeLeft', {
                            time: formatNomadPageCountdown(pageLoadingRemainingSec),
                          })
                        : t('nomadNetwork.pageLoadingStillWorking')}
                    </p>
                  ) : null}
                </div>
              ) : pageError ? (
                <div className="space-y-2">
                  <p className="text-sm text-red-300">
                    {t('nomadNetwork.pageFailed', { error: pageError })}
                  </p>
                  {selectedNode && isNomadLastSeenStale(selectedNode.last_seen) ? (
                    <p className="text-xs text-orange-200/90">
                      {t('nomadNetwork.staleLastSeenHint', {
                        time: formatRelativeOrIsoDate((selectedNode.last_seen ?? 0) * 1000, t),
                      })}
                    </p>
                  ) : null}
                </div>
              ) : pageContent != null ? (
                isNomadMicronPage(pageContentType, pagePath) && !showPageSource ? (
                  <NomadMicronPageView
                    content={
                      pageContentTruncated
                        ? `${pageContent}\n\n[${t('nomadNetwork.pageTruncated')}]`
                        : pageContent
                    }
                    defaultPagePath={DEFAULT_NOMAD_NODE_PAGE_PATH}
                    selectedHash={selectedHash}
                    fitWidth={pageFitWidth}
                    onNavigate={handleMicronNavigate}
                    onDownloadFile={handleMicronDownload}
                    onOpenDm={onOpenDm}
                    onFetchPartial={fetchNomadPage}
                    onFetchMedia={fetchNomadMedia}
                  />
                ) : (
                  <pre
                    className={`text-ink-200 font-mono text-xs leading-relaxed ${
                      pageFitWidth ? 'max-w-full break-words whitespace-pre-wrap' : 'whitespace-pre'
                    }`}
                  >
                    {pageContentTruncated
                      ? `${pageContent}\n\n[${t('nomadNetwork.pageTruncated')}]`
                      : pageContent}
                  </pre>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="text-ink-100 flex h-full min-h-0 min-w-0 flex-col">
      {showStartStackBanner && (
        <p className="rounded-card mb-3 border border-orange-600/40 bg-orange-950/20 p-3 text-sm text-orange-200">
          {t('connectionPanel.reticulumIdentity.startStackFirst')}
        </p>
      )}
      {sidecarRunning && !nomadApiAvailable && (
        <p className="rounded-card mb-3 border border-orange-600/40 bg-orange-950/20 p-3 text-sm text-orange-200">
          {t('nomadNetwork.unavailable')}
        </p>
      )}
      <ConversationLayout
        mode={layoutMode}
        list={listColumn}
        listLabel={t('nomadNetwork.title')}
        listOpen={!nodeListCollapsed}
        compactPane={compactPane}
        conversation={viewer}
        keepConversationMounted
      />
      {pendingIdentifyConfirm ? (
        <ConfirmModal
          title={t('nomadNetwork.identifyConfirmTitle', { name: pendingIdentifyConfirm.name })}
          message={t('nomadNetwork.identifyConfirmBody', { name: pendingIdentifyConfirm.name })}
          confirmLabel={t('nomadNetwork.identifyConfirmAccept')}
          onConfirm={() => {
            const { hash } = pendingIdentifyConfirm;
            setPendingIdentifyConfirm(null);
            void applyIdentify(hash, true);
          }}
          onCancel={() => {
            setPendingIdentifyConfirm(null);
          }}
        />
      ) : null}
      {pendingClearAllIdentify ? (
        <ConfirmModal
          title={t('nomadNetwork.identifyClearAllTitle')}
          message={t('nomadNetwork.identifyClearAllBody', { count: identifyingCount })}
          confirmLabel={t('nomadNetwork.identifyClearAll')}
          onConfirm={() => {
            void confirmClearAllIdentify();
          }}
          onCancel={() => {
            setPendingClearAllIdentify(false);
          }}
        />
      ) : null}
    </div>
  );
}
