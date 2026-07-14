import { ChevronLeft, ChevronRight, PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import {
  DEFAULT_NOMAD_NODE_PAGE_PATH,
  isNomadMicronPage,
  normalizeNomadPagePath,
  parseNomadNetworkLinkUrl,
} from '@/renderer/lib/nomad/micronParser';
import { downloadNomadFileFromBase64 } from '@/renderer/lib/nomad/nomadFileDownload';
import {
  clearNomadPageCache,
  getNomadPageCache,
  MAX_NOMAD_PAGE_CACHE_CHARS,
  setNomadPageCache,
} from '@/renderer/lib/nomad/nomadPageCache';
import { humanizeNomadPageError } from '@/renderer/lib/nomad/nomadPageErrorHumanize';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadNodeRow, NomadPageRequestData } from '@/shared/nomad-types';

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import NomadMicronPageView from './NomadMicronPageView';

type NomadListTab = 'favourites' | 'announces';

interface NomadHistoryEntry {
  hash: string;
  path: string;
}

interface LoadNodePageOptions {
  fromHistory?: boolean;
  forceReload?: boolean;
  requestData?: NomadPageRequestData;
}

/** Cap displayed page size to avoid renderer stress on huge Micron pages. */
const MAX_NOMAD_PAGE_DISPLAY_CHARS = MAX_NOMAD_PAGE_CACHE_CHARS;

const NOMAD_NODE_LIST_COLLAPSED_STORAGE_KEY = 'mesh-client:nomadNodeListCollapsed';

function nomadCollapsedLabel(displayName: string | null | undefined, hash: string): string {
  const name = displayName?.trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return hash.slice(0, 2).toUpperCase();
}

function formatNomadUrlBar(hash: string, path: string): string {
  return `${hash}:${path}`;
}

function truncateNomadPageContent(content: string): { text: string; truncated: boolean } {
  if (content.length <= MAX_NOMAD_PAGE_DISPLAY_CHARS) {
    return { text: content, truncated: false };
  }
  return { text: content.slice(0, MAX_NOMAD_PAGE_DISPLAY_CHARS), truncated: true };
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

function NomadCollapsedNodeItem({
  node,
  isSelected,
  openNodeLabel,
  onOpenNode,
}: {
  node: NomadNodeRow;
  isSelected: boolean;
  openNodeLabel: string;
  onOpenNode: (hash: string) => void;
}) {
  const label = node.display_name ?? node.destination_hash.slice(0, 16);

  return (
    <div
      role="button"
      tabIndex={0}
      {...{ [PARENT_HOVER_ATTR]: '' }}
      onClick={() => {
        onOpenNode(node.destination_hash);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenNode(node.destination_hash);
        }
      }}
      className={`w-full cursor-pointer border-b border-gray-800 text-left transition-colors hover:bg-gray-800/60 ${
        isSelected
          ? 'border-bright-green bg-sidebar-active-bg border-l-2 px-1 py-1.5'
          : 'border-l-2 border-transparent px-1 py-1.5'
      }`}
      title={label}
      aria-label={openNodeLabel}
    >
      <div className="relative flex flex-col items-center gap-0.5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] leading-none font-semibold ${
            isSelected ? 'text-bright-green bg-gray-800' : 'bg-gray-800/80 text-gray-200'
          }`}
          aria-hidden
        >
          {nomadCollapsedLabel(node.display_name, node.destination_hash)}
        </span>
        <span className={node.favorited ? 'text-yellow-400' : 'text-gray-500'} aria-hidden>
          ★
        </span>
      </div>
    </div>
  );
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
}) {
  const label = node.display_name ?? node.destination_hash.slice(0, 16);

  return (
    <div
      className={`mx-2 mb-2 rounded border px-3 py-2 text-sm last:mb-0 ${
        isSelected ? 'border-bright-green/60 bg-slate-800/80' : 'border-gray-700/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-label={openNodeLabel}
          onClick={() => {
            onOpenNode(node.destination_hash);
          }}
        >
          <div className="truncate font-medium text-gray-100">{label}</div>
          <div className="text-muted truncate font-mono text-xs">
            {formatHash(node.destination_hash)}
          </div>
          <div className="text-muted mt-1 flex flex-wrap gap-x-2 text-xs">
            {hopsAwayLabel ? <span>{hopsAwayLabel}</span> : null}
            {lastSeenLabel ? <span>{lastSeenLabel}</span> : null}
          </div>
        </button>
        <button
          type="button"
          className={node.favorited ? 'text-yellow-400' : 'text-gray-500'}
          aria-label={toggleFavoriteLabel}
          onClick={() => {
            onToggleFavorite(node.destination_hash, !node.favorited);
          }}
        >
          ★
        </button>
      </div>
    </div>
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
  const nodes = useNomadNetworkStore((s) => s.nodes);
  const lastRefreshAt = useNomadNetworkStore((s) => s.lastRefreshAt);
  const nomadApiAvailable = useNomadNetworkStore((s) => s.nomadApiAvailable);
  const refreshFromSidecar = useNomadNetworkStore((s) => s.refreshFromSidecar);
  const fetchNomadPage = useNomadNetworkStore((s) => s.fetchNomadPage);
  const fetchNomadFile = useNomadNetworkStore((s) => s.fetchNomadFile);
  const toggleFavorite = useNomadNetworkStore((s) => s.toggleFavorite);

  const [activeTab, setActiveTab] = useState<NomadListTab>('favourites');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [pagePath, setPagePath] = useState(DEFAULT_NOMAD_NODE_PAGE_PATH);
  const [urlBarValue, setUrlBarValue] = useState('');
  const [historyStack, setHistoryStack] = useState<NomadHistoryEntry[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [pageContentType, setPageContentType] = useState<string | undefined>(undefined);
  const [showPageSource, setShowPageSource] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [fileDownloading, setFileDownloading] = useState(false);
  const [fileDownloadError, setFileDownloadError] = useState<string | null>(null);
  const [nodeListCollapsed, setNodeListCollapsed] = useState(
    () => localStorage.getItem(NOMAD_NODE_LIST_COLLAPSED_STORAGE_KEY) === 'true',
  );
  const pageRequestSeqRef = useRef(0);
  const fileDownloadInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const historyIndexRef = useRef(-1);
  const listCollapseTrigger = useParentIconTrigger();

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    if (isActive && selectedHash == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset list tab when panel becomes visible without a page open
      setActiveTab('favourites');
    }
  }, [isActive, selectedHash]);

  const pushHistoryEntry = useCallback((hash: string, path: string) => {
    const normalizedPath = normalizeNomadPagePath(path);
    setHistoryStack((prev) => {
      const idx = historyIndexRef.current;
      const last = prev[idx];
      if (last?.hash.toLowerCase() === hash.toLowerCase() && last.path === normalizedPath) {
        return prev;
      }
      const truncated = prev.slice(0, idx + 1);
      const next = [...truncated, { hash, path: normalizedPath }];
      const nextIndex = next.length - 1;
      historyIndexRef.current = nextIndex;
      setHistoryIndex(nextIndex);
      return next;
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pageRequestSeqRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const applyRunning = (running: boolean) => {
      setSidecarRunning(running);
      if (running) void refreshFromSidecar();
    };
    void isReticulumSidecarRunning().then(applyRunning);
    const unsub = window.electronAPI.reticulum.onStatus((status) => {
      applyRunning(status.running && status.port > 0);
    });
    return unsub;
  }, [refreshFromSidecar]);

  const allRows = useMemo(() => [...nodes.values()], [nodes]);

  const tabRows = useMemo(() => {
    if (activeTab === 'favourites') {
      return allRows.filter((node) => node.favorited);
    }
    return allRows;
  }, [activeTab, allRows]);

  const filteredRows = useMemo(
    () => tabRows.filter((node) => matchesSearch(node, searchQuery)),
    [tabRows, searchQuery],
  );

  const favouritesCount = useMemo(() => allRows.filter((node) => node.favorited).length, [allRows]);

  const selectedNode = selectedHash ? nodes.get(selectedHash.toLowerCase()) : undefined;

  const applyPageResult = useCallback(
    (
      hash: string,
      normalizedPath: string,
      content: string,
      contentType: string | undefined,
      truncated: boolean,
    ) => {
      setPageContent(truncated ? `${content}\n\n[${t('nomadNetwork.pageTruncated')}]` : content);
      setPageContentType(contentType);
      setUrlBarValue(formatNomadUrlBar(hash, normalizedPath));
    },
    [t],
  );

  const loadNodePage = useCallback(
    async (hash: string, path: string, options: LoadNodePageOptions = {}) => {
      const normalizedPath = normalizeNomadPagePath(path);
      const requestSeq = ++pageRequestSeqRef.current;
      setSelectedHash(hash);
      setPagePath(normalizedPath);
      setPageLoading(true);
      setPageError(null);
      setShowPageSource(false);

      if (!options.forceReload) {
        const cached = getNomadPageCache({ hash, path: normalizedPath });
        if (cached) {
          if (!mountedRef.current || requestSeq !== pageRequestSeqRef.current) return;
          setPageLoading(false);
          applyPageResult(hash, normalizedPath, cached.content, cached.content_type, false);
          if (!options.fromHistory) {
            pushHistoryEntry(hash, normalizedPath);
          }
          return;
        }
      }

      setPageContent(null);
      setPageContentType(undefined);
      const res = await fetchNomadPage(hash, normalizedPath, options.requestData);
      if (!mountedRef.current || requestSeq !== pageRequestSeqRef.current) return;
      setPageLoading(false);
      if (!res.ok || !res.content) {
        setPageError(humanizeNomadPageError(res.error, t));
        return;
      }
      const { text, truncated } = truncateNomadPageContent(res.content);
      applyPageResult(hash, normalizedPath, text, res.content_type, truncated);
      setNomadPageCache(
        {
          hash,
          path: normalizedPath,
        },
        {
          content: truncated ? text : res.content,
          content_type: res.content_type,
        },
      );
      if (!options.fromHistory) {
        pushHistoryEntry(hash, normalizedPath);
      }
    },
    [applyPageResult, fetchNomadPage, pushHistoryEntry, t],
  );

  const downloadNodeFile = useCallback(
    async (hash: string, path: string) => {
      if (fileDownloadInFlightRef.current) {
        setFileDownloadError(t('nomadNetwork.fileDownloadInProgress'));
        return;
      }
      fileDownloadInFlightRef.current = true;
      setFileDownloading(true);
      setFileDownloadError(null);
      try {
        const normalizedPath = normalizeNomadPagePath(path);
        const res = await fetchNomadFile(hash, normalizedPath);
        if (!mountedRef.current) return;
        if (!res.ok || !res.content_base64) {
          setFileDownloadError(humanizeNomadPageError(res.error, t));
          return;
        }
        const fileName = res.file_name ?? normalizedPath.split('/').pop() ?? 'downloaded_file';
        downloadNomadFileFromBase64(fileName, res.content_base64);
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
      void loadNodePage(entry.hash, entry.path, { fromHistory: true });
    },
    [historyIndex, historyStack, loadNodePage],
  );

  const submitUrlBar = useCallback(() => {
    if (!selectedNode) return;
    const trimmed = urlBarValue.trim();
    if (!trimmed) return;

    let target = trimmed;
    if (target.startsWith(':')) {
      target = `${selectedNode.destination_hash}${target}`;
    }

    const parsed = parseNomadNetworkLinkUrl(target, DEFAULT_NOMAD_NODE_PAGE_PATH);
    if (!parsed) {
      setPageError(t('nomadNetwork.invalidUrl'));
      return;
    }

    const hash = parsed.destination_hash ?? selectedNode.destination_hash;
    void loadNodePage(hash, parsed.path);
  }, [loadNodePage, selectedNode, t, urlBarValue]);

  const closeViewer = useCallback(() => {
    setSelectedHash(null);
    setPageContent(null);
    setPageError(null);
    setUrlBarValue('');
    setHistoryStack([]);
    historyIndexRef.current = -1;
    setHistoryIndex(-1);
    setActiveTab('favourites');
    clearNomadPageCache();
  }, []);

  const handleNodeListToggle = useCallback(() => {
    setNodeListCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NOMAD_NODE_LIST_COLLAPSED_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const handleOpenNode = useCallback(
    (hash: string) => {
      void loadNodePage(hash, DEFAULT_NOMAD_NODE_PAGE_PATH);
    },
    [loadNodePage],
  );

  const handleToggleFavorite = useCallback(
    (hash: string, favorited: boolean) => {
      void toggleFavorite(hash, favorited);
    },
    [toggleFavorite],
  );

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

  const searchPlaceholder =
    activeTab === 'favourites'
      ? t('nomadNetwork.searchFavourites', { count: favouritesCount })
      : t('nomadNetwork.searchAnnounces', { count: allRows.length });

  const emptyKey =
    activeTab === 'favourites' ? 'nomadNetwork.emptyFavourites' : 'nomadNetwork.emptyAnnounces';

  const activeTabCount = activeTab === 'favourites' ? favouritesCount : allRows.length;
  const activeTabLabel =
    activeTab === 'favourites' ? t('nomadNetwork.favourites') : t('nomadNetwork.announces');

  const showStartStackBanner = !sidecarRunning && lastRefreshAt == null && allRows.length === 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-gray-100">{t('nomadNetwork.title')}</h2>
        <button
          type="button"
          className="text-xs text-amber-400 hover:underline"
          onClick={() => {
            void refreshFromSidecar();
          }}
        >
          {t('common.refresh')}
        </button>
      </div>

      {showStartStackBanner ? (
        <p className="mb-3 rounded-lg border border-amber-600/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          {t('connectionPanel.reticulumIdentity.startStackFirst')}
        </p>
      ) : null}

      {sidecarRunning && !nomadApiAvailable ? (
        <p className="mb-3 rounded-lg border border-amber-600/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          {t('nomadNetwork.unavailable')}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div
          className={`bg-secondary-dark flex min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-gray-700 transition-[width] duration-300 ${
            nodeListCollapsed ? 'w-16' : 'w-72'
          }`}
        >
          {!nodeListCollapsed && (
            <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm font-medium text-gray-200">
                {activeTabLabel} <span className="text-gray-500">({activeTabCount})</span>
              </span>
            </div>
          )}

          {!nodeListCollapsed && (
            <>
              <div className="mb-0 flex gap-4 border-b border-gray-700 px-3 text-sm">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'favourites'}
                  className={`border-b-2 pb-2 ${
                    activeTab === 'favourites'
                      ? 'border-bright-green text-bright-green'
                      : 'text-muted border-transparent'
                  }`}
                  onClick={() => {
                    setActiveTab('favourites');
                  }}
                >
                  {t('nomadNetwork.favourites')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'announces'}
                  className={`border-b-2 pb-2 ${
                    activeTab === 'announces'
                      ? 'border-bright-green text-bright-green'
                      : 'text-muted border-transparent'
                  }`}
                  onClick={() => {
                    setActiveTab('announces');
                  }}
                >
                  {t('nomadNetwork.announces')}
                </button>
              </div>

              <div className="px-3 pt-3">
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                  }}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="mb-3 w-full rounded border border-gray-600 bg-slate-900 px-3 py-2 text-sm text-gray-200"
                />
              </div>
            </>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!nodeListCollapsed && filteredRows.length === 0 ? (
              <p className="text-muted px-3 pb-3 text-sm">{t(emptyKey)}</p>
            ) : (
              filteredRows.map((node) => {
                const isSelected =
                  selectedHash?.toLowerCase() === node.destination_hash.toLowerCase();
                const label = node.display_name ?? node.destination_hash.slice(0, 16);
                const openNodeLabel = t('nomadNetwork.openNode', { name: label });

                if (nodeListCollapsed) {
                  return (
                    <NomadCollapsedNodeItem
                      key={node.destination_hash}
                      node={node}
                      isSelected={isSelected}
                      openNodeLabel={openNodeLabel}
                      onOpenNode={handleOpenNode}
                    />
                  );
                }

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
              })
            )}
          </div>

          <button
            type="button"
            onClick={handleNodeListToggle}
            aria-expanded={!nodeListCollapsed}
            aria-label={
              nodeListCollapsed
                ? t('nomadNetwork.expandNodeList')
                : t('nomadNetwork.collapseNodeList')
            }
            className="text-muted hover:text-bright-green mx-2 mt-auto mb-2 flex shrink-0 items-center justify-center rounded-sm border border-gray-700 py-2 transition-colors hover:border-gray-600"
          >
            {nodeListCollapsed ? (
              <ChevronRight
                aria-hidden
                className={ICON_MD}
                trigger={listCollapseTrigger}
                size={16}
              />
            ) : (
              <ChevronLeft
                aria-hidden
                className={ICON_MD}
                trigger={listCollapseTrigger}
                size={16}
              />
            )}
          </button>
        </div>

        <div className="bg-secondary-dark flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-700">
          {!selectedNode ? (
            <p className="text-muted m-auto max-w-sm p-6 text-center text-sm">
              {t('nomadNetwork.selectNode')}
            </p>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-700/60 p-2">
                <span className="truncate font-medium text-gray-100">
                  {selectedNode.display_name ?? selectedNode.destination_hash.slice(0, 16)}
                </span>
                {selectedNode.hops != null ? (
                  <span className="text-muted text-xs">
                    {t('nomadNetwork.hopsAway', { count: selectedNode.hops })}
                  </span>
                ) : null}
                <div className="ml-auto flex flex-wrap gap-1">
                  {onOpenDm ? (
                    <button
                      type="button"
                      disabled={!sidecarRunning}
                      className="rounded border border-purple-600 px-2 py-1 text-xs text-purple-300 hover:bg-purple-900/30 disabled:opacity-40"
                      aria-label={t('nomadNetwork.sendMessageAria', {
                        name:
                          selectedNode.display_name ?? selectedNode.destination_hash.slice(0, 16),
                      })}
                      onClick={() => {
                        onOpenDm(selectedNode.destination_hash);
                      }}
                    >
                      {t('nomadNetwork.sendMessage')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={!canGoBack}
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
                    aria-label={t('nomadNetwork.back')}
                    onClick={() => {
                      navigateHistory(-1);
                    }}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={!canGoForward}
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
                    aria-label={t('nomadNetwork.forward')}
                    onClick={() => {
                      navigateHistory(1);
                    }}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800"
                    aria-label={t('nomadNetwork.homePage')}
                    onClick={() => {
                      void loadNodePage(
                        selectedNode.destination_hash,
                        DEFAULT_NOMAD_NODE_PAGE_PATH,
                      );
                    }}
                  >
                    ⌂
                  </button>
                  {isNomadMicronPage(pageContentType, pagePath) && pageContent != null ? (
                    <button
                      type="button"
                      className={`rounded border px-2 py-1 text-xs ${
                        showPageSource
                          ? 'border-bright-green/60 bg-bright-green/20 text-bright-green'
                          : 'border-gray-600 text-gray-200 hover:bg-slate-800'
                      }`}
                      aria-label={
                        showPageSource ? t('nomadNetwork.hideSource') : t('nomadNetwork.showSource')
                      }
                      aria-pressed={showPageSource}
                      onClick={() => {
                        setShowPageSource((prev) => !prev);
                      }}
                    >
                      {'</>'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800"
                    aria-label={t('nomadNetwork.reloadPage')}
                    onClick={() => {
                      void loadNodePage(selectedNode.destination_hash, pagePath, {
                        forceReload: true,
                      });
                    }}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800"
                    aria-label={t('nomadNetwork.closeViewer')}
                    onClick={closeViewer}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <form
                className="flex shrink-0 gap-2 border-b border-gray-700/60 p-2"
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
                  className="min-w-0 flex-1 rounded border border-gray-600 bg-slate-900 px-2 py-1 font-mono text-xs text-gray-200"
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
                  {pageLoading ? (
                    <p className="text-muted text-sm">{t('nomadNetwork.pageLoading')}</p>
                  ) : pageError ? (
                    <p className="text-sm text-red-300">
                      {t('nomadNetwork.pageFailed', { error: pageError })}
                    </p>
                  ) : pageContent != null ? (
                    isNomadMicronPage(pageContentType, pagePath) && !showPageSource ? (
                      <NomadMicronPageView
                        content={pageContent}
                        defaultPagePath={DEFAULT_NOMAD_NODE_PAGE_PATH}
                        selectedHash={selectedNode.destination_hash}
                        onNavigate={handleMicronNavigate}
                        onDownloadFile={handleMicronDownload}
                        onOpenDm={onOpenDm}
                      />
                    ) : (
                      <pre className="font-mono text-xs leading-relaxed whitespace-pre text-gray-200">
                        {pageContent}
                      </pre>
                    )
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
