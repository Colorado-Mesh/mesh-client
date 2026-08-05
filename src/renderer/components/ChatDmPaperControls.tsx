import { FileText, QrCode } from 'lucide-react-motion';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import QrCodeImage from '@/renderer/components/QrCodeImage';
import QrIngestControl from '@/renderer/components/QrIngestControl';
import { useToast } from '@/renderer/components/Toast';
import { useActiveMeshIdentity } from '@/renderer/hooks/useActiveMeshIdentity';
import { loadDraftsInitial } from '@/renderer/lib/chatPanelProtocolStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { createReticulumPaperMessage } from '@/renderer/lib/reticulum/createReticulumPaperMessage';
import { handleReticulumQrIngest } from '@/renderer/lib/reticulum/handleReticulumQrIngest';
import { showReticulumQrIngestToast } from '@/renderer/lib/reticulum/showReticulumQrIngestToast';
import { RETICULUM_DM_HEADER_ACTION_CLASS } from '@/renderer/lib/reticulumDmHeaderActions';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';

export interface ChatDmPaperShareControlProps {
  lxmfPeerHash: string;
  viewKey: string;
  sidecarRunning: boolean;
  className?: string;
}

/**
 * Chat DM header: open a modal to create an encrypted LXMF paper QR from the draft (or typed text).
 */
export function ChatDmPaperShareControl({
  lxmfPeerHash,
  viewKey,
  sidecarRunning,
  className = RETICULUM_DM_HEADER_ACTION_CLASS,
}: Readonly<ChatDmPaperShareControlProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const { focusedIdentityId } = useActiveMeshIdentity('reticulum');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openModal = useCallback(() => {
    const drafts = loadDraftsInitial('reticulum');
    setText((drafts[viewKey] ?? '').trim());
    setUri(null);
    setOpen(true);
  }, [viewKey]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setUri(null);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        closeModal();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [busy, closeModal, open]);

  const createPaper = useCallback(async () => {
    if (busy || !focusedIdentityId) return;
    setBusy(true);
    try {
      const result = await createReticulumPaperMessage({
        identityId: focusedIdentityId,
        destinationHash: lxmfPeerHash,
        text,
      });
      if (!result.ok) {
        addToast(t(result.errorKey), 'error');
        return;
      }
      setUri(result.uri);
    } finally {
      setBusy(false);
    }
  }, [addToast, busy, focusedIdentityId, lxmfPeerHash, t, text]);

  const shareButton = (
    <button
      type="button"
      className={className}
      disabled={!sidecarRunning}
      aria-label={t('chatPanel.shareAsPaperAria')}
      onClick={openModal}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{t('chatPanel.shareAsPaper')}</span>
    </button>
  );

  if (!open) {
    return shareButton;
  }

  return (
    <>
      {shareButton}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0"
          aria-label={t('chatPanel.shareAsPaperClose')}
          disabled={busy}
          onClick={closeModal}
        />
        <div
          className="bg-deep-black relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-gray-700 p-4 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-label={t('chatPanel.shareAsPaperTitle')}
        >
          <h2 className="text-sm font-semibold text-gray-100">
            {t('chatPanel.shareAsPaperTitle')}
          </h2>
          <p className="text-muted mt-1 text-xs">{t('chatPanel.shareAsPaperHint')}</p>
          {uri == null ? (
            <>
              <label className="mt-3 block">
                <span className="sr-only">{t('chatPanel.shareAsPaperMessageLabel')}</span>
                <textarea
                  className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-100"
                  rows={4}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                  }}
                  disabled={busy}
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="bg-readable-green rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  disabled={busy || !text.trim() || !focusedIdentityId}
                  onClick={() => {
                    void createPaper();
                  }}
                >
                  {t('chatPanel.shareAsPaperGenerate')}
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300"
                  disabled={busy}
                  onClick={closeModal}
                >
                  {t('chatPanel.shareAsPaperClose')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mt-3 flex justify-center">
                <QrCodeImage value={uri} size={220} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="bg-readable-green rounded px-3 py-1.5 text-xs font-medium text-white"
                  onClick={() => {
                    void writeClipboardText(uri)
                      .then(() => {
                        addToast(t('chatPanel.shareAsPaperCopied'), 'success');
                      })
                      .catch((err: unknown) => {
                        console.warn(
                          '[ChatDmPaperShareControl] clipboard failed: ' + errLikeToLogString(err),
                        );
                        addToast(t('chatPanel.shareAsPaperCopyFailed'), 'error');
                      });
                  }}
                >
                  {t('chatPanel.shareAsPaperCopyUri')}
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300"
                  onClick={closeModal}
                >
                  {t('chatPanel.shareAsPaperClose')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export interface ChatPaperScanControlProps {
  sidecarRunning: boolean;
}

/** Compact Chat scan/paste for paper (and other Reticulum QR) without leaving Chat. */
export function ChatPaperScanControl({ sidecarRunning }: Readonly<ChatPaperScanControlProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-1">
      <button
        type="button"
        className="text-muted inline-flex items-center gap-1 text-[11px] hover:text-gray-200"
        aria-label={t('chatPanel.scanPaperAria')}
        aria-expanded={expanded}
        disabled={!sidecarRunning}
        onClick={() => {
          setExpanded((v) => !v);
        }}
      >
        <QrCode className="h-3 w-3" aria-hidden />
        {t('chatPanel.scanPaper')}
      </button>
      {expanded ? (
        <div className="mt-1 rounded border border-gray-700/80 bg-slate-900/40 p-2">
          <p className="text-muted mb-1 text-[11px]">{t('chatPanel.scanPaperHint')}</p>
          <QrIngestControl
            disabled={!sidecarRunning}
            onDecoded={(decoded) => {
              void (async () => {
                const outcome = await handleReticulumQrIngest(decoded);
                if (showReticulumQrIngestToast(outcome, { t, addToast })) {
                  if (outcome.handled && outcome.toast.variant === 'success') setExpanded(false);
                }
              })().catch((err: unknown) => {
                console.error('[ChatPaperScanControl] ingest failed: ' + errLikeToLogString(err));
                addToast(t('qrIngest.unknownLink'), 'error');
              });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
