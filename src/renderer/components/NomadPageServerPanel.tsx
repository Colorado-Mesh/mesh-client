import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isValidMicronPageName } from '@/renderer/lib/nomad/micronPageName';
import { humanizeNomadPageError } from '@/renderer/lib/nomad/nomadPageErrorHumanize';
import {
  planServingListsApply,
  planServingStatusApply,
} from '@/renderer/lib/nomad/nomadPageServerRefresh';
import {
  deleteServingPage,
  getServingPageRaw,
  getServingStatus,
  listServingPages,
  pickServingContentSource,
  setServing as setServingApi,
  setServingContentSource,
} from '@/renderer/lib/nomad/nomadServingApi';
import type { NomadServingPageEntry, NomadServingStatus } from '@/shared/nomad-types';

import MicronPageEditor from './MicronPageEditor';

/** Starter body for a brand-new page so the preview is not blank. */
const NEW_PAGE_TEMPLATE = '>New page\n\nEdit this text.\n';

interface EditorTarget {
  path: string;
  content: string;
  /** False for a page that does not exist on disk yet. */
  existing: boolean;
}

/** Avoid repeating the same hosting failure warn on every poll. */
let lastLoggedHostingError: string | null = null;

export default function NomadPageServerPanel({
  isActive,
  onPreviewHostedSite,
}: Readonly<{
  isActive?: boolean;
  /** Open the local hosted destination in the Nomad browser. */
  onPreviewHostedSite?: (destinationHash: string) => void;
}>) {
  const { t } = useTranslation();
  const [sidecarRunning, setSidecarRunning] = useState(false);
  const [status, setStatus] = useState<NomadServingStatus | null>(null);
  const [pages, setPages] = useState<NomadServingPageEntry[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  /** Content-relative path awaiting delete confirmation, if any. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshSeqRef = useRef(0);
  /** Prefer local edits over poll/status refresh until Start/Stop serving succeeds. */
  const displayNameDirtyRef = useRef(false);

  const applyStatusError = useCallback(
    (serving: NomadServingStatus | null | undefined) => {
      const code = serving?.last_error?.trim();
      if (!code) return;
      if (lastLoggedHostingError !== code) {
        lastLoggedHostingError = code;
        console.warn('[NomadHosting]', code);
      }
      setError(humanizeNomadPageError(code, t));
    },
    [t],
  );

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    const seq = ++refreshSeqRef.current;
    try {
      const statusRes = await getServingStatus();
      if (seq !== refreshSeqRef.current) return;

      const statusPlan = planServingStatusApply(statusRes, displayNameDirtyRef.current);
      if (statusPlan.kind === 'sidecar_down') {
        setSidecarRunning(false);
        return;
      }
      setSidecarRunning(true);
      if (statusPlan.kind === 'status') {
        setStatus(statusPlan.serving as NomadServingStatus);
        if (statusPlan.displayName !== undefined) {
          setDisplayName(statusPlan.displayName);
        }
        if (statusPlan.statusError) {
          applyStatusError(statusPlan.serving as NomadServingStatus);
        } else if (statusPlan.clearHostingErrorLog) {
          lastLoggedHostingError = null;
        }
      } else if (statusPlan.kind === 'status_error') {
        setError(humanizeNomadPageError(statusPlan.error, t));
      }

      const pagesRes = await listServingPages();
      if (seq !== refreshSeqRef.current) return;
      const listsPlan = planServingListsApply(statusRes, pagesRes);
      if (listsPlan.pages) {
        setPages(listsPlan.pages as NomadServingPageEntry[]);
      }
      if (listsPlan.clearError) {
        setError(null);
      } else if (listsPlan.pagesError) {
        setError(humanizeNomadPageError(listsPlan.pagesError, t));
      }
    } finally {
      if (seq === refreshSeqRef.current) {
        refreshInFlightRef.current = false;
      }
    }
  }, [applyStatusError, t]);

  useEffect(() => {
    if (!isActive) return;
    // Allow sidecar hydrate only when the panel becomes active — not on every
    // refresh() identity change (which would wipe in-progress name edits).
    displayNameDirtyRef.current = false;
  }, [isActive]);

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
          if (body.serving) {
            setStatus(body.serving);
            applyStatusError(body.serving);
          }
          if (opts?.onOk) await opts.onOk();
        }
        if (!opts?.skipRefresh) await refresh();
      } catch (e) {
        // catch-no-log-ok surfaced in the panel error state
        setError(humanizeNomadPageError(String(e), t) || t(failKey));
      } finally {
        setBusy(false);
      }
    },
    [applyStatusError, refresh, t],
  );

  const setServing = async (enabled: boolean) => {
    await runServingAction(async () => {
      const body = await setServingApi({ enabled, displayName });
      if (body.ok) {
        displayNameDirtyRef.current = false;
        if (body.serving?.display_name != null) {
          setDisplayName(body.serving.display_name);
        }
      }
      return body;
    }, 'nomadNetwork.serving.failed');
  };

  const chooseFolder = async () => {
    setBusy(true);
    setError(null);
    try {
      const picked = await pickServingContentSource();
      if (!picked.ok) {
        if ('canceled' in picked && picked.canceled) return;
        setError(humanizeNomadPageError('error' in picked ? picked.error : null, t));
        return;
      }
      const body = await setServingContentSource(picked.path);
      if (!body.ok) {
        console.warn('[NomadHosting] content source set failed:', body.error);
        setError(
          humanizeNomadPageError(body.error, t) || t('nomadNetwork.serving.contentSourceFailed'),
        );
        return;
      }
      if (body.serving) setStatus(body.serving);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const newPage = () => {
    const name = window.prompt(t('nomadNetwork.serving.newPageName'), 'index.mu');
    if (name == null) return;
    const trimmed = name.trim();
    if (!isValidMicronPageName(trimmed)) {
      setError(t('nomadNetwork.serving.invalidPageName'));
      return;
    }
    setError(null);
    setEditorTarget({ path: trimmed, content: NEW_PAGE_TEMPLATE, existing: false });
  };

  const editPage = async (entry: NomadServingPageEntry) => {
    setBusy(true);
    setError(null);
    try {
      // Pass the listed path through verbatim; it is what the read route expects.
      const res = await getServingPageRaw(entry.path);
      if (!res.ok) {
        console.warn('[NomadHosting] page read failed:', res.error);
        // Do not open an empty editor over a page we failed to read.
        setError(humanizeNomadPageError(res.error, t) || t('nomadNetwork.serving.openError'));
        return;
      }
      setEditorTarget({ path: entry.path, content: res.content, existing: true });
    } finally {
      setBusy(false);
    }
  };

  const removePage = async (path: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteServingPage(path);
      if (!res.ok) {
        console.warn('[NomadHosting] page delete failed:', res.error);
        setError(humanizeNomadPageError(res.error, t) || t('nomadNetwork.serving.deleteError'));
        return;
      }
      await refresh();
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
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
  const canPreview =
    serving && Boolean(status?.destination_hash) && typeof onPreviewHostedSite === 'function';
  const hasContentSource = Boolean(status?.content_source?.trim());
  const contentSourceLabel =
    status?.content_source?.trim() || t('nomadNetwork.serving.contentSourceNone');
  const watcherDegraded =
    status?.watcher_status === 'degraded' || status?.watcher_status === 'unavailable';

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

      <p className="text-muted text-xs">{t('nomadNetwork.serving.folderHint')}</p>

      <div className="flex flex-col gap-1 text-sm text-gray-200">
        <span>{t('nomadNetwork.serving.contentSource')}</span>
        <code className="truncate font-mono text-xs text-gray-300" title={contentSourceLabel}>
          {contentSourceLabel}
        </code>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !sidecarRunning}
            onClick={() => {
              void chooseFolder();
            }}
            aria-label={t('nomadNetwork.serving.chooseFolderAria')}
            className="border-bright-green/60 text-bright-green hover:bg-bright-green/10 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {t('nomadNetwork.serving.chooseFolder')}
          </button>
          {watcherDegraded ? (
            <button
              type="button"
              disabled={busy || !sidecarRunning}
              onClick={() => {
                void refresh();
              }}
              aria-label={t('nomadNetwork.serving.reloadFromDiskAria')}
              className="rounded border border-amber-600 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/30 disabled:opacity-40"
            >
              {t('nomadNetwork.serving.reloadFromDisk')}
            </button>
          ) : null}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm text-gray-200">
        <span>{t('nomadNetwork.serving.displayName')}</span>
        <input
          type="text"
          value={displayName}
          disabled={busy || !sidecarRunning}
          onChange={(e) => {
            displayNameDirtyRef.current = true;
            setDisplayName(e.target.value);
          }}
          aria-label={t('nomadNetwork.serving.displayName')}
          className="rounded border border-gray-600 bg-slate-900 px-3 py-2 text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !sidecarRunning || serving || !hasContentSource}
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
        {canPreview ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const hash = status?.destination_hash;
              if (hash) onPreviewHostedSite?.(hash);
            }}
            aria-label={t('nomadNetwork.serving.previewSiteAria')}
            className="rounded border border-purple-600 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-900/30 disabled:opacity-40"
          >
            {t('nomadNetwork.serving.previewSite')}
          </button>
        ) : null}
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="text-sm font-medium text-gray-100">{t('nomadNetwork.serving.myPages')}</h4>
          <button
            type="button"
            disabled={busy || !sidecarRunning || !hasContentSource}
            onClick={newPage}
            aria-label={t('nomadNetwork.serving.newPage')}
            className="border-bright-green/60 text-bright-green hover:bg-bright-green/10 rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            {t('nomadNetwork.serving.newPage')}
          </button>
        </div>
        <ul className="mb-3 space-y-1">
          {pages.length === 0 ? (
            <li className="text-muted text-sm">{t('nomadNetwork.serving.noPages')}</li>
          ) : (
            pages.map((page) => (
              <li key={page.path} className="flex items-center gap-2 text-sm">
                <span className="truncate text-gray-200">{page.path}</span>
                <span className="text-muted shrink-0 text-[10px]">{page.size} B</span>
                <button
                  type="button"
                  disabled={busy || !sidecarRunning || !hasContentSource}
                  onClick={() => {
                    void editPage(page);
                  }}
                  aria-label={t('nomadNetwork.serving.editPage', { path: page.path })}
                  className="ml-auto shrink-0 rounded border border-gray-600 px-2 py-0.5 text-[10px] text-gray-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  {t('nomadNetwork.serving.edit')}
                </button>
                {pendingDelete === page.path ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void removePage(page.path);
                      }}
                      aria-label={t('nomadNetwork.serving.deleteConfirmAria')}
                      className="shrink-0 rounded border border-red-600 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/30 disabled:opacity-40"
                    >
                      {t('common.confirm')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setPendingDelete(null);
                      }}
                      aria-label={t('common.cancel')}
                      className="shrink-0 rounded border border-gray-600 px-2 py-0.5 text-[10px] text-gray-200 hover:bg-slate-800 disabled:opacity-40"
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !sidecarRunning || !hasContentSource}
                    onClick={() => {
                      setPendingDelete(page.path);
                    }}
                    aria-label={t('nomadNetwork.serving.deletePage', { path: page.path })}
                    className="shrink-0 rounded border border-red-600 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/30 disabled:opacity-40"
                  >
                    {t('nomadNetwork.serving.delete')}
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      </div>

      {editorTarget ? (
        <MicronPageEditor
          path={editorTarget.path}
          initialContent={editorTarget.content}
          canDelete={editorTarget.existing}
          onSaved={() => {
            void refresh();
          }}
          onDeleted={() => {
            setEditorTarget(null);
            void refresh();
          }}
          onClose={() => {
            setEditorTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
