import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { analyzeNomadPageAcl, appendNomadPageAclHash } from '@/renderer/lib/nomad/nomadPageAcl';
import { humanizeNomadPageError } from '@/renderer/lib/nomad/nomadPageErrorHumanize';
import {
  deleteServingPageAcl,
  getServingPageAcl,
  putServingPageAcl,
} from '@/renderer/lib/nomad/nomadServingApi';

import { useReticulumIdentityStore } from '../stores/reticulumIdentityStore';
import { FIELD_SURFACE_CLASS } from './ui/formClasses';

export default function NomadPageAccessDialog({
  path,
  onChanged,
  onClose,
}: Readonly<{
  /** Content-relative page path (e.g. `index.mu`); the sidecar resolves `.allowed`. */
  path: string;
  onChanged: () => void;
  onClose: () => void;
}>) {
  const { t } = useTranslation();
  const titleId = useId();
  const textareaId = useId();
  const ownIdentityHash = useReticulumIdentityStore((s) => s.identity?.identity_hash ?? '');
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getServingPageAcl(path);
      if (cancelled) return;
      if (!res.ok) {
        console.warn('[NomadHosting] page access read failed:', res.error);
        setError(
          humanizeNomadPageError(res.error, t) || t('nomadNetwork.serving.restrictLoadError'),
        );
      } else {
        setExists(res.exists);
        setDraft(res.content);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [path, t]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const analysis = useMemo(() => analyzeNomadPageAcl(draft), [draft]);
  const ownHashListed = Boolean(ownIdentityHash) && analysis.hashes.includes(ownIdentityHash);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await putServingPageAcl(path, draft);
      if (!res.ok) {
        console.warn('[NomadHosting] page access save failed:', res.error);
        setError(
          humanizeNomadPageError(res.error, t) || t('nomadNetwork.serving.restrictSaveError'),
        );
        return;
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [draft, onChanged, onClose, path, t]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteServingPageAcl(path);
      if (!res.ok) {
        console.warn('[NomadHosting] page access remove failed:', res.error);
        setError(
          humanizeNomadPageError(res.error, t) || t('nomadNetwork.serving.restrictRemoveError'),
        );
        return;
      }
      onChanged();
      onClose();
    } finally {
      setBusy(false);
      setConfirmingRemove(false);
    }
  }, [onChanged, onClose, path, t]);

  const disabled = busy || loading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('nomadNetwork.serving.restrictCloseAria')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-deep-black rounded-modal shadow-level-3 border-ink-600 relative mx-4 flex w-full max-w-lg flex-col gap-3 border p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={titleId} className="text-ink-100 text-sm font-medium">
            {t('nomadNetwork.serving.restrictTitle')}
          </h3>
          <code className="text-ink-300 truncate font-mono text-xs">{path}</code>
        </div>

        <p className="text-muted text-xs">{t('nomadNetwork.serving.restrictHint')}</p>
        <p className="text-muted text-xs">
          {exists
            ? t('nomadNetwork.serving.restrictStatusOn', { count: analysis.hashes.length })
            : t('nomadNetwork.serving.restrictStatusOff')}
        </p>

        <label htmlFor={textareaId} className="text-ink-200 text-xs">
          {t('nomadNetwork.serving.restrictListLabel')}
        </label>
        <textarea
          id={textareaId}
          value={draft}
          disabled={disabled}
          spellCheck={false}
          rows={8}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          aria-label={t('nomadNetwork.serving.restrictListAria', { path })}
          className={`${FIELD_SURFACE_CLASS} min-h-32 w-full resize-y font-mono text-xs`}
        />

        {analysis.invalidLines.length > 0 ? (
          <p className="text-xs text-red-400" role="alert">
            {t('nomadNetwork.serving.restrictInvalidLines', {
              lines: analysis.invalidLines.join(', '),
            })}
          </p>
        ) : null}
        {!loading && analysis.hashes.length === 0 && analysis.invalidLines.length === 0 ? (
          <p className="text-xs text-orange-300">
            {t('nomadNetwork.serving.restrictEmptyWarning')}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled || !ownIdentityHash || ownHashListed}
            onClick={() => {
              setDraft((text) => appendNomadPageAclHash(text, ownIdentityHash));
            }}
            aria-label={t('nomadNetwork.serving.restrictAddSelfAria')}
            title={
              ownIdentityHash
                ? t('nomadNetwork.serving.restrictAddSelfAria')
                : t('nomadNetwork.serving.restrictAddSelfUnavailable')
            }
            className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            {t('nomadNetwork.serving.restrictAddSelf')}
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            {exists ? (
              confirmingRemove ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void remove();
                    }}
                    aria-label={t('nomadNetwork.serving.restrictRemoveConfirmAria')}
                    className="rounded border border-red-600 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30 disabled:opacity-40"
                  >
                    {t('common.confirm')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingRemove(false);
                    }}
                    aria-label={t('common.cancel')}
                    className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setConfirmingRemove(true);
                  }}
                  aria-label={t('nomadNetwork.serving.restrictRemoveAria', { path })}
                  className="rounded border border-red-600 px-2 py-1 text-xs text-red-300 hover:bg-red-900/30 disabled:opacity-40"
                >
                  {t('nomadNetwork.serving.restrictRemove')}
                </button>
              )
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              aria-label={t('common.cancel')}
              className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              disabled={disabled || analysis.invalidLines.length > 0}
              onClick={() => {
                void save();
              }}
              aria-label={t('nomadNetwork.serving.restrictSaveAria', { path })}
              className="bg-brand-green text-app-bg rounded px-3 py-1 text-xs font-medium disabled:opacity-40"
            >
              {t('nomadNetwork.serving.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
