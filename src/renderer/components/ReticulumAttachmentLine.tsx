import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatInlineImage } from '@/renderer/components/chat/ChatInlineImage';
import {
  isReticulumAudioAttachment,
  isReticulumImageAttachment,
  parseReticulumAttachmentPayload,
} from '@/renderer/lib/reticulum/parseReticulumAttachmentPayload';
import type { ReticulumCachedAttachment } from '@/shared/reticulumCachedAttachment';

export interface ReticulumAttachmentLineProps {
  payload: string;
  /** Jailed on-disk path from inbound LXMF cache, when available (first file). */
  attachmentPath?: string;
  /** Multi-file LXMF attachments; when set, each entry is rendered. */
  attachments?: ReticulumCachedAttachment[];
}

function reticulumAttachmentLabel(
  t: (key: string, opts: { name: string }) => string,
  fileName: string,
  mimeType: string,
): string {
  if (isReticulumImageAttachment(mimeType)) {
    return t('chatPanel.reticulumImageAttachment', { name: fileName });
  }
  if (isReticulumAudioAttachment(mimeType)) {
    return t('chatPanel.reticulumAudioAttachment', { name: fileName });
  }
  return t('chatPanel.reticulumFileAttachment', { name: fileName });
}

function dataUrlToBase64(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1).trim();
  return b64.length > 0 ? b64 : null;
}

function ReticulumAttachmentItem({
  fileName,
  mimeType,
  attachmentPath,
}: Readonly<{
  fileName: string;
  mimeType: string;
  attachmentPath?: string;
}>) {
  const { t } = useTranslation();
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canRenderImage =
    Boolean(attachmentPath) && Boolean(mimeType) && isReticulumImageAttachment(mimeType);
  const fetchKey =
    canRenderImage && attachmentPath && mimeType ? `${attachmentPath}\0${mimeType}` : null;

  useEffect(() => {
    if (fetchKey == null || !attachmentPath || !mimeType) return;
    let cancelled = false;
    window.electronAPI.chat
      .readReticulumAttachmentAsDataUrl({ filePath: attachmentPath, mimeType })
      .then((res) => {
        if (cancelled) return;
        setImageDataUrl(res.dataUrl);
        setFetchedFor(fetchKey);
        setImageFailed(false);
      })
      .catch(() => {
        // catch-no-log-ok: fall back to label-only when read fails
        if (cancelled) return;
        setImageDataUrl(null);
        setFetchedFor(fetchKey);
        setImageFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentPath, fetchKey, mimeType]);

  const label = reticulumAttachmentLabel(t, fileName, mimeType);
  const showImage =
    fetchKey != null && fetchedFor === fetchKey && Boolean(imageDataUrl) && !imageFailed;

  const onSave = async () => {
    if (!attachmentPath || busy) return;
    setBusy(true);
    try {
      let dataBase64 =
        fetchedFor === fetchKey && imageDataUrl != null ? dataUrlToBase64(imageDataUrl) : null;
      if (!dataBase64) {
        const res = await window.electronAPI.chat.readReticulumAttachmentAsDataUrl({
          filePath: attachmentPath,
          mimeType,
        });
        dataBase64 = res.dataUrl ? dataUrlToBase64(res.dataUrl) : null;
      }
      if (!dataBase64) {
        const bytes = await window.electronAPI.chat.readReticulumAttachmentBytes(attachmentPath);
        dataBase64 = bytes.dataBase64;
      }
      if (!dataBase64) return;
      await window.electronAPI.chat.saveReticulumAttachment({
        fileName,
        dataBase64,
        promptSave: true,
      });
    } catch {
      // catch-no-log-ok: save dialog cancel / read failure
    } finally {
      setBusy(false);
    }
  };

  const onReveal = async () => {
    if (!attachmentPath) return;
    try {
      await window.electronAPI.chat.showItemInFolder(attachmentPath);
    } catch {
      // catch-no-log-ok: reveal unavailable
    }
  };

  return (
    <div className="border-ink-700/80 bg-ink-900/60 text-ink-300 mt-1 flex flex-col gap-2 rounded border px-2 py-1.5 text-xs">
      {showImage && imageDataUrl ? (
        <ChatInlineImage
          src={imageDataUrl}
          alt={t('chatPayload.reticulumAttachmentImage', { name: fileName })}
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : null}
      <span>{label}</span>
      {attachmentPath ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-sky-400 underline-offset-2 hover:underline disabled:opacity-50"
            disabled={busy}
            aria-label={t('chatPanel.saveAttachmentAria', { name: fileName })}
            onClick={() => {
              void onSave();
            }}
          >
            {t('chatPanel.saveAttachment')}
          </button>
          <button
            type="button"
            className="text-sky-400 underline-offset-2 hover:underline"
            aria-label={t('chatPanel.revealAttachmentAria', { name: fileName })}
            onClick={() => {
              void onReveal();
            }}
          >
            {t('chatPanel.revealAttachment')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Read-only label (and inline image when cached) for historic LXMF `[file:name:mime]` payloads. */
export function ReticulumAttachmentLine({
  payload,
  attachmentPath,
  attachments,
}: Readonly<ReticulumAttachmentLineProps>) {
  const parsed = parseReticulumAttachmentPayload(payload);
  const items: ReticulumCachedAttachment[] =
    attachments && attachments.length > 0
      ? attachments
      : parsed
        ? [
            {
              path: attachmentPath ?? '',
              fileName: parsed.fileName,
              mimeType: parsed.mimeType,
            },
          ]
        : [];

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <ReticulumAttachmentItem
          key={`${item.path}:${item.fileName}`}
          fileName={item.fileName}
          mimeType={item.mimeType}
          attachmentPath={item.path || attachmentPath}
        />
      ))}
    </div>
  );
}
