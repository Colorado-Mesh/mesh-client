import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { mountNomadMicronHtml, renderNomadMicronPage } from '@/renderer/lib/nomad/micronParser';
import {
  applyMicronDivider,
  applyMicronLinePrefix,
  applyMicronLink,
  applyMicronWrap,
  type MicronEditResult,
  type MicronLineAction,
  type MicronWrapAction,
} from '@/renderer/lib/nomad/micronToolbar';
import { humanizeNomadPageError } from '@/renderer/lib/nomad/nomadPageErrorHumanize';
import { deleteServingPage, putServingPage } from '@/renderer/lib/nomad/nomadServingApi';

/** Preview re-render debounce; keeps typing responsive on large pages. */
const PREVIEW_DEBOUNCE_MS = 200;

export interface MicronPageEditorProps {
  /** Content-relative path, e.g. `index.mu` or `page/foo.mu`. */
  path: string;
  /** Initial raw Micron source. Empty for a new page. */
  initialContent: string;
  /** Existing pages may be deleted; a not-yet-saved new page may not. */
  canDelete?: boolean;
  onSaved?: (content: string) => void;
  onDeleted?: () => void;
  onClose: () => void;
}

const WRAP_ACTIONS: { action: MicronWrapAction; labelKey: string }[] = [
  { action: 'bold', labelKey: 'nomadNetwork.serving.toolbar.bold' },
  { action: 'italic', labelKey: 'nomadNetwork.serving.toolbar.italic' },
  { action: 'underline', labelKey: 'nomadNetwork.serving.toolbar.underline' },
];

const LINE_ACTIONS: { action: MicronLineAction; labelKey: string }[] = [
  { action: 'h1', labelKey: 'nomadNetwork.serving.toolbar.h1' },
  { action: 'h2', labelKey: 'nomadNetwork.serving.toolbar.h2' },
  { action: 'h3', labelKey: 'nomadNetwork.serving.toolbar.h3' },
  { action: 'alignLeft', labelKey: 'nomadNetwork.serving.toolbar.alignLeft' },
  { action: 'alignCenter', labelKey: 'nomadNetwork.serving.toolbar.alignCenter' },
  { action: 'alignRight', labelKey: 'nomadNetwork.serving.toolbar.alignRight' },
];

export default function MicronPageEditor({
  path,
  initialContent,
  canDelete,
  onSaved,
  onDeleted,
  onClose,
}: Readonly<MicronPageEditorProps>) {
  const { t } = useTranslation();
  const titleId = useId();
  const [content, setContent] = useState(initialContent);
  /** Last successfully persisted body; drives the dirty indicator. */
  const [savedContent, setSavedContent] = useState(initialContent);
  const [preview, setPreview] = useState(initialContent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const dirty = content !== savedContent;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPreview(content);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [content]);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    // Parser output is DOMPurify-sanitized; mount avoids an innerHTML sink.
    mountNomadMicronHtml(container, renderNomadMicronPage(preview));
  }, [preview]);

  /** Apply a toolbar transform and restore the caret the transform asked for. */
  const applyEdit = useCallback((next: MicronEditResult) => {
    setContent(next.content);
    const el = textareaRef.current;
    if (!el) return;
    // The value is controlled, so wait for React to commit before moving the caret.
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }, []);

  const editState = useCallback(() => {
    const el = textareaRef.current;
    return {
      content,
      start: el?.selectionStart ?? content.length,
      end: el?.selectionEnd ?? content.length,
    };
  }, [content]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await putServingPage(path, content);
      if (!res.ok) {
        console.warn('[MicronPageEditor] save failed:', res.error);
        // Keep the editor open with the draft intact so the user can retry.
        setError(humanizeNomadPageError(res.error, t) || t('nomadNetwork.serving.saveError'));
        return;
      }
      setSavedContent(content);
      onSaved?.(content);
    } finally {
      setBusy(false);
    }
  }, [content, onSaved, path, t]);

  const remove = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await deleteServingPage(path);
      if (!res.ok) {
        console.warn('[MicronPageEditor] delete failed:', res.error);
        setError(humanizeNomadPageError(res.error, t) || t('nomadNetwork.serving.deleteError'));
        return;
      }
      onDeleted?.();
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }, [onDeleted, path, t]);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [requestClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('nomadNetwork.serving.closeBackdropAria')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={requestClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-deep-black relative mx-4 flex h-[85vh] w-full max-w-5xl flex-col gap-3 rounded-xl border border-gray-600 p-4 shadow-2xl"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={titleId} className="text-sm font-medium text-gray-100">
            {t('nomadNetwork.serving.editorTitle')}
          </h3>
          <code className="truncate font-mono text-xs text-gray-300">{path}</code>
          {dirty ? (
            <span className="rounded bg-amber-700 px-2 py-0.5 text-[10px] font-medium text-white">
              {t('nomadNetwork.serving.unsaved')}
            </span>
          ) : null}
        </div>

        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label={t('nomadNetwork.serving.toolbarAria')}
        >
          {WRAP_ACTIONS.map(({ action, labelKey }) => (
            <button
              key={action}
              type="button"
              disabled={busy}
              onClick={() => {
                applyEdit(applyMicronWrap(editState(), action));
              }}
              aria-label={t(labelKey)}
              className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
            >
              {t(labelKey)}
            </button>
          ))}
          {LINE_ACTIONS.map(({ action, labelKey }) => (
            <button
              key={action}
              type="button"
              disabled={busy}
              onClick={() => {
                applyEdit(applyMicronLinePrefix(editState(), action));
              }}
              aria-label={t(labelKey)}
              className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
            >
              {t(labelKey)}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              applyEdit(applyMicronDivider(editState()));
            }}
            aria-label={t('nomadNetwork.serving.toolbar.divider')}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {t('nomadNetwork.serving.toolbar.divider')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const destination = window.prompt(t('nomadNetwork.serving.linkTargetPrompt'));
              if (destination == null) return;
              const trimmed = destination.trim();
              if (!trimmed) return;
              applyEdit(applyMicronLink(editState(), trimmed));
            }}
            aria-label={t('nomadNetwork.serving.toolbar.link')}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
          >
            {t('nomadNetwork.serving.toolbar.link')}
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
          <textarea
            ref={textareaRef}
            value={content}
            spellCheck={false}
            onChange={(e) => {
              setContent(e.target.value);
            }}
            aria-label={t('nomadNetwork.serving.editorAria')}
            className="min-h-0 resize-none rounded border border-gray-600 bg-slate-900 p-3 font-mono text-xs text-gray-200"
          />
          <div className="min-h-0 overflow-y-auto rounded border border-gray-600 bg-slate-900 p-3">
            <p className="text-muted mb-2 text-[10px] uppercase">
              {t('nomadNetwork.serving.editorPreview')}
            </p>
            <div ref={previewRef} />
          </div>
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        {confirmingClose ? (
          <p className="text-sm text-amber-300">{t('nomadNetwork.serving.discardConfirm')}</p>
        ) : null}
        {confirmingDelete ? (
          <p className="text-sm text-amber-300">{t('nomadNetwork.serving.deleteConfirm')}</p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !dirty}
            onClick={() => {
              void save();
            }}
            aria-label={t('nomadNetwork.serving.save')}
            className="border-bright-green/60 text-bright-green hover:bg-bright-green/10 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
          >
            {t('nomadNetwork.serving.save')}
          </button>

          {canDelete ? (
            confirmingDelete ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void remove();
                  }}
                  aria-label={t('nomadNetwork.serving.deleteConfirmAria')}
                  className="rounded border border-red-600 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/30 disabled:opacity-40"
                >
                  {t('common.confirm')}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingDelete(false);
                  }}
                  aria-label={t('common.cancel')}
                  className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
                >
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(true);
                }}
                aria-label={t('nomadNetwork.serving.deletePage', { path })}
                className="rounded border border-red-600 px-3 py-1.5 text-xs text-red-300 hover:bg-red-900/30 disabled:opacity-40"
              >
                {t('nomadNetwork.serving.deletePage', { path })}
              </button>
            )
          ) : null}

          <div className="flex-1" />

          {confirmingClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('nomadNetwork.serving.discardConfirmAria')}
              className="rounded border border-amber-600 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-900/30"
            >
              {t('nomadNetwork.serving.discard')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={requestClose}
            aria-label={t('nomadNetwork.serving.close')}
            className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800"
          >
            {t('nomadNetwork.serving.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
