import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatRelativeOrIsoDate } from '@/renderer/lib/formatRelativeOrIsoDate';
import {
  DEFAULT_NOMAD_NODE_PAGE_PATH,
  isNomadMicronPage,
  normalizeNomadPagePath,
} from '@/renderer/lib/nomad/micronParser';
import { downloadNomadFileFromBase64 } from '@/renderer/lib/nomad/nomadFileDownload';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadNodeRow } from '@/shared/nomad-types';

import { useNomadNetworkStore } from '../stores/nomadNetworkStore';
import NomadMicronPageView from './NomadMicronPageView';

type NomadListTab = 'favourites' | 'announces';

/** Cap displayed page size to avoid renderer stress on huge Micron pages. */
const MAX_NOMAD_PAGE_DISPLAY_CHARS = 256 * 1024;

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

export default function NomadNetworkPanel() {
  const { t } = useTranslation();
  const nodes = useNomadNetworkStore((s) => s.nodes);
  const lastRefreshAt = useNomadNetworkStore((s) => s.lastRefreshAt);
  const nomadApiAvailable = useNomadNetworkStore((s) => s.nomadApiAvailable);
  const refreshFromSidecar = useNomadNetworkStore((s) => s.refreshFromSidecar);
  const fetchNomadPage = useNomadNetworkStore((s) => s.fetchNomadPage);
  const fetchNomadFile = useNomadNetworkStore((s) => s.fetchNomadFile);
  const toggleFavorite = useNomadNetworkStore((s) => s.toggleFavorite);

  const [activeTab, setActiveTab] = useState<NomadListTab>('announces');
  const [searchQuery, setSearchQuery] = useState('');
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [pagePath, setPagePath] = useState(DEFAULT_NOMAD_NODE_PAGE_PATH);
  const [pageContent, setPageContent] = useState<string | null>(null);
  const [pageContentType, setPageContentType] = useState<string | undefined>(undefined);
  const [showPageSource, setShowPageSource] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [fileDownloading, setFileDownloading] = useState(false);
  const [fileDownloadError, setFileDownloadError] = useState<string | null>(null);
  const pageRequestSeqRef = useRef(0);
  const fileDownloadInFlightRef = useRef(false);
  const mountedRef = useRef(true);

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

  const loadNodePage = useCallback(
    async (hash: string, path: string) => {
      const normalizedPath = normalizeNomadPagePath(path);
      const requestSeq = ++pageRequestSeqRef.current;
      setSelectedHash(hash);
      setPagePath(normalizedPath);
      setPageLoading(true);
      setPageError(null);
      setPageContent(null);
      setPageContentType(undefined);
      setShowPageSource(false);
      const res = await fetchNomadPage(hash, normalizedPath);
      if (!mountedRef.current || requestSeq !== pageRequestSeqRef.current) return;
      setPageLoading(false);
      if (!res.ok || !res.content) {
        setPageError(res.error ?? t('common.error'));
        return;
      }
      const { text, truncated } = truncateNomadPageContent(res.content);
      setPageContent(truncated ? `${text}\n\n[${t('nomadNetwork.pageTruncated')}]` : text);
      setPageContentType(res.content_type);
    },
    [fetchNomadPage, t],
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
      const normalizedPath = normalizeNomadPagePath(path);
      const res = await fetchNomadFile(hash, normalizedPath);
      if (!mountedRef.current) return;
      fileDownloadInFlightRef.current = false;
      setFileDownloading(false);
      if (!res.ok || !res.content_base64) {
        setFileDownloadError(res.error ?? t('common.error'));
        return;
      }
      const fileName = res.file_name ?? normalizedPath.split('/').pop() ?? 'downloaded_file';
      downloadNomadFileFromBase64(fileName, res.content_base64);
    },
    [fetchNomadFile, t],
  );

  const searchPlaceholder =
    activeTab === 'favourites'
      ? t('nomadNetwork.searchFavourites', { count: favouritesCount })
      : t('nomadNetwork.searchAnnounces', { count: allRows.length });

  const emptyKey =
    activeTab === 'favourites' ? 'nomadNetwork.emptyFavourites' : 'nomadNetwork.emptyAnnounces';

  const showStartStackBanner = !sidecarRunning && lastRefreshAt == null && allRows.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-col lg:w-[22rem] lg:shrink-0 lg:border-r lg:border-gray-700 lg:pr-3">
          <div className="mb-3 flex gap-4 border-b border-gray-700 text-sm">
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

          {filteredRows.length === 0 ? (
            <p className="text-muted text-sm">{t(emptyKey)}</p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm">
              {filteredRows.map((node) => {
                const isSelected =
                  selectedHash?.toLowerCase() === node.destination_hash.toLowerCase();
                const label = node.display_name ?? node.destination_hash.slice(0, 16);
                return (
                  <li
                    key={node.destination_hash}
                    className={`rounded border px-3 py-2 ${
                      isSelected ? 'border-bright-green/60 bg-slate-800/80' : 'border-gray-700/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        aria-label={t('nomadNetwork.openNode', { name: label })}
                        onClick={() => {
                          void loadNodePage(node.destination_hash, DEFAULT_NOMAD_NODE_PAGE_PATH);
                        }}
                      >
                        <div className="truncate font-medium text-gray-100">{label}</div>
                        <div className="text-muted truncate font-mono text-xs">
                          {formatNomadHash(node.destination_hash)}
                        </div>
                        <div className="text-muted mt-1 flex flex-wrap gap-x-2 text-xs">
                          {node.hops != null ? (
                            <span>{t('nomadNetwork.hopsAway', { count: node.hops })}</span>
                          ) : null}
                          {node.last_seen ? (
                            <span>
                              {t('nomadNetwork.lastSeen', {
                                time: formatRelativeOrIsoDate(node.last_seen * 1000, t),
                              })}
                            </span>
                          ) : null}
                        </div>
                      </button>
                      <button
                        type="button"
                        className={node.favorited ? 'text-yellow-400' : 'text-gray-500'}
                        aria-label={t('nomadNetwork.toggleFavorite')}
                        onClick={() => {
                          void toggleFavorite(node.destination_hash, !node.favorited);
                        }}
                      >
                        ★
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-gray-700/60 bg-slate-950/40">
          {!selectedNode ? (
            <p className="text-muted m-auto max-w-sm p-6 text-center text-sm">
              {t('nomadNetwork.selectNode')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-gray-700/60 p-2">
                <span className="truncate font-medium text-gray-100">
                  {selectedNode.display_name ?? selectedNode.destination_hash.slice(0, 16)}
                </span>
                {selectedNode.hops != null ? (
                  <span className="text-muted text-xs">
                    {t('nomadNetwork.hopsAway', { count: selectedNode.hops })}
                  </span>
                ) : null}
                <div className="ml-auto flex flex-wrap gap-1">
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
                      void loadNodePage(selectedNode.destination_hash, pagePath);
                    }}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800"
                    aria-label={t('nomadNetwork.closeViewer')}
                    onClick={() => {
                      setSelectedHash(null);
                      setPageContent(null);
                      setPageError(null);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <form
                className="flex gap-2 border-b border-gray-700/60 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadNodePage(selectedNode.destination_hash, pagePath);
                }}
              >
                <input
                  type="text"
                  value={pagePath}
                  onChange={(e) => {
                    setPagePath(e.target.value);
                  }}
                  aria-label={t('nomadNetwork.pagePathAria')}
                  placeholder={t('nomadNetwork.pagePath')}
                  className="min-w-0 flex-1 rounded border border-gray-600 bg-slate-900 px-2 py-1 font-mono text-xs text-gray-200"
                />
              </form>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
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
                      onNavigate={(hash, path) => {
                        void loadNodePage(hash, path);
                      }}
                      onDownloadFile={(hash, path) => {
                        void downloadNodeFile(hash, path);
                      }}
                    />
                  ) : (
                    <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-gray-200">
                      {pageContent}
                    </pre>
                  )
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
