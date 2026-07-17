import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { humanizeNomadPageError } from '@/renderer/lib/nomad/nomadPageErrorHumanize';
import {
  deleteServingPage,
  getServingStatus,
  listServingPages,
  readServingPage,
  setServing as setServingApi,
  writeServingPage,
} from '@/renderer/lib/nomad/nomadServingApi';
import type { NomadServingPageEntry, NomadServingStatus } from '@/shared/nomad-types';

const DEFAULT_PAGE_CONTENT = `#!c=30
> New page

Edit this Micron page, then save.
`;

export default function NomadPageServerPanel({ isActive }: { isActive?: boolean }) {
  const { t } = useTranslation();
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [status, setStatus] = useState<NomadServingStatus | null>(null);
  const [pages, setPages] = useState<NomadServingPageEntry[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [newPagePath, setNewPagePath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const refreshInFlightRef = useRef(false);
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const seq = ++refreshSeqRef.current;
    try {
      const statusRes = await getServingStatus();
      if (seq !== refreshSeqRef.current) return;
      if (statusRes.error === 'sidecar_not_running') {
        setSidecarRunning(false);
        return;
      }
      setSidecarRunning(true);
      if (statusRes.ok && statusRes.serving) {
        setStatus(statusRes.serving);
        setDisplayName(statusRes.serving.display_name ?? '');
      } else if (!statusRes.ok) {
        setError(humanizeNomadPageError(statusRes.error, t));
      }

      const pagesRes = await listServingPages();
      if (seq !== refreshSeqRef.current) return;
      if (pagesRes.ok && pagesRes.pages) {
        setPages(pagesRes.pages);
        if (statusRes.ok) setError(null);
      } else if (!pagesRes.ok) {
        setError(humanizeNomadPageError(pagesRes.error, t));
      }
    } finally {
      if (seq === refreshSeqRef.current) {
        refreshInFlightRef.current = false;
      }
    }
  }, [t]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void refresh();
    const unsub = window.electronAPI.reticulum.onStatus((s) => {
      if (cancelled) return;
      setSidecarRunning(s.running && s.port > 0);
      if (s.running) void refresh();
    });
    return () => {
      cancelled = true;
      refreshSeqRef.current += 1;
      refreshInFlightRef.current = false;
      unsub();
    };
  }, [isActive, refresh]);

  const runServingAction = useCallback(
    async (
      fn: () => Promise<{ ok: boolean; error?: string; serving?: NomadServingStatus }>,
      failKey: string,
      opts?: { skipRefresh?: boolean; onOk?: () => void | Promise<void> },
    ) => {
      setBusy(true);
      setError(null);
      try {
        const body = await fn();
        if (!body.ok) {
          setError(humanizeNomadPageError(body.error, t) || t(failKey));
        } else {
          if (body.serving) setStatus(body.serving);
          if (opts?.onOk) await opts.onOk();
        }
        if (!opts?.skipRefresh) await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, t],
  );

  const setServing = async (enabled: boolean) => {
    await runServingAction(
      () => setServingApi({ enabled, displayName }),
      'nomadNetwork.serving.failed',
    );
  };

  const loadPage = async (path: string) => {
    await runServingAction(
      async () => {
        const body = await readServingPage(path);
        if (!body.ok || body.content == null) {
          return { ok: false, error: body.error };
        }
        setSelectedPath(path);
        setEditorContent(body.content);
        return { ok: true };
      },
      'nomadNetwork.serving.loadPageFailed',
      { skipRefresh: true },
    );
  };

  const savePage = async () => {
    if (!selectedPath) return;
    await runServingAction(
      () => writeServingPage(selectedPath, editorContent),
      'nomadNetwork.serving.saveFailed',
    );
  };

  const createPage = async () => {
    const path = newPagePath.trim().replace(/^\/+/, '');
    if (!path) return;
    setBusy(true);
    setError(null);
    try {
      const body = await writeServingPage(path, DEFAULT_PAGE_CONTENT);
      if (!body.ok) {
        setError(humanizeNomadPageError(body.error, t) || t('nomadNetwork.serving.saveFailed'));
        return;
      }
      setNewPagePath('');
      await refresh();
      await loadPage(path);
    } finally {
      setBusy(false);
    }
  };

  const deletePage = async (path: string) => {
    await runServingAction(async () => {
      const body = await deleteServingPage(path);
      if (!body.ok) return body;
      if (selectedPath === path) {
        setSelectedPath(null);
        setEditorContent('');
      }
      return body;
    }, 'nomadNetwork.serving.deleteFailed');
  };

  const copyHash = async () => {
    const hash = status?.destination_hash;
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch (e) {
      // catch-no-log-ok surfaced in the panel error state
      setError(humanizeNomadPageError(String(e), t));
    }
  };

  const serving = status?.running === true;
  const stats = status?.stats;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-gray-100">{t('nomadNetwork.serving.title')}</h3>
        {serving ? (
          <span className="bg-readable-green rounded px-2 py-0.5 text-[10px] font-medium text-white">
            {t('nomadNetwork.serving.servingChip')}
          </span>
        ) : null}
      </div>

      {!sidecarRunning ? (
        <p className="text-muted text-sm">{t('nomadNetwork.serving.sidecarRequired')}</p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm text-gray-200">
        <span>{t('nomadNetwork.serving.displayName')}</span>
        <input
          type="text"
          value={displayName}
          disabled={busy || !sidecarRunning}
          onChange={(e) => {
            setDisplayName(e.target.value);
          }}
          aria-label={t('nomadNetwork.serving.displayName')}
          className="rounded border border-gray-600 bg-slate-900 px-3 py-2 text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !sidecarRunning || serving}
          onClick={() => {
            void setServing(true);
          }}
          aria-label={t('nomadNetwork.serving.enable')}
          className="border-bright-green/60 text-bright-green hover:bg-bright-green/10 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {t('nomadNetwork.serving.enable')}
        </button>
        <button
          type="button"
          disabled={busy || !sidecarRunning || !serving}
          onClick={() => {
            void setServing(false);
          }}
          aria-label={t('nomadNetwork.serving.disable')}
          className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('nomadNetwork.serving.disable')}
        </button>
      </div>

      {status?.destination_hash ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
          <span className="text-muted">{t('nomadNetwork.serving.destinationHash')}</span>
          <code className="truncate font-mono">{status.destination_hash}</code>
          <button
            type="button"
            onClick={() => {
              void copyHash();
            }}
            aria-label={t('nomadNetwork.serving.copyHash')}
            className="rounded border border-gray-600 px-2 py-0.5 hover:bg-slate-800"
          >
            {copied ? t('nomadNetwork.serving.copied') : t('nomadNetwork.serving.copyHash')}
          </button>
        </div>
      ) : null}

      {stats ? (
        <p className="text-muted text-xs">
          {t('nomadNetwork.serving.stats', {
            pages: status?.page_count ?? 0,
            files: status?.file_count ?? 0,
            requests: stats.request_count,
          })}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="border-t border-gray-700 pt-3">
        <h4 className="mb-2 text-sm font-medium text-gray-100">
          {t('nomadNetwork.serving.myPages')}
        </h4>
        <ul className="mb-3 space-y-1">
          {pages.length === 0 ? (
            <li className="text-muted text-sm">{t('nomadNetwork.serving.noPages')}</li>
          ) : (
            pages.map((page) => (
              <li key={page.path} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void loadPage(page.path);
                  }}
                  aria-label={t('nomadNetwork.serving.editPage', { path: page.path })}
                  className={`hover:text-bright-green truncate text-left ${
                    selectedPath === page.path ? 'text-bright-green' : 'text-gray-200'
                  }`}
                >
                  {page.path}
                </button>
                <span className="text-muted shrink-0 text-[10px]">{page.size} B</span>
                <button
                  type="button"
                  disabled={busy || page.path === 'index.mu'}
                  onClick={() => {
                    void deletePage(page.path);
                  }}
                  aria-label={t('nomadNetwork.serving.deletePage', { path: page.path })}
                  className="text-red-400 hover:underline disabled:opacity-30"
                >
                  {t('common.delete')}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="mb-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={newPagePath}
            disabled={busy || !sidecarRunning}
            onChange={(e) => {
              setNewPagePath(e.target.value);
            }}
            placeholder={t('nomadNetwork.serving.newPagePlaceholder')}
            aria-label={t('nomadNetwork.serving.newPagePlaceholder')}
            className="min-w-0 flex-1 rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={busy || !sidecarRunning || !newPagePath.trim()}
            onClick={() => {
              void createPage();
            }}
            aria-label={t('nomadNetwork.serving.createPage')}
            className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {t('nomadNetwork.serving.createPage')}
          </button>
        </div>

        {selectedPath ? (
          <div className="flex min-h-0 flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm text-gray-200">
              <span>{t('nomadNetwork.serving.editing', { path: selectedPath })}</span>
              <textarea
                value={editorContent}
                disabled={busy}
                onChange={(e) => {
                  setEditorContent(e.target.value);
                }}
                aria-label={t('nomadNetwork.serving.editorAria', { path: selectedPath })}
                rows={12}
                className="rounded border border-gray-600 bg-slate-900 px-3 py-2 font-mono text-xs"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void savePage();
              }}
              aria-label={t('nomadNetwork.serving.savePage')}
              className="border-bright-green/60 text-bright-green hover:bg-bright-green/10 self-start rounded border px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {t('nomadNetwork.serving.savePage')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
