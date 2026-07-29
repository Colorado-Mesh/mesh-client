import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isReticulumAudioAttachment,
  isReticulumImageAttachment,
  parseReticulumAttachmentPayload,
} from '@/renderer/lib/reticulum/parseReticulumAttachmentPayload';

export interface ReticulumAttachmentLineProps {
  payload: string;
  /** Jailed on-disk path from inbound LXMF cache, when available. */
  attachmentPath?: string;
}

/** Read-only label (and inline image when cached) for historic LXMF `[file:name:mime]` payloads. */
export function ReticulumAttachmentLine({ payload, attachmentPath }: ReticulumAttachmentLineProps) {
  const { t } = useTranslation();
  const parsed = parseReticulumAttachmentPayload(payload);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [fetchedFor, setFetchedFor] = useState<string | null>(null);

  const mimeType = parsed?.mimeType;
  const canRenderImage =
    Boolean(attachmentPath) &&
    Boolean(mimeType) &&
    isReticulumImageAttachment(mimeType!) &&
    !mimeType!.toLowerCase().startsWith('image/svg');
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

  if (!parsed) return null;

  const label = isReticulumImageAttachment(parsed.mimeType)
    ? t('chatPanel.reticulumImageAttachment', { name: parsed.fileName })
    : isReticulumAudioAttachment(parsed.mimeType)
      ? t('chatPanel.reticulumAudioAttachment', { name: parsed.fileName })
      : t('chatPanel.reticulumFileAttachment', { name: parsed.fileName });

  const showImage =
    fetchKey != null && fetchedFor === fetchKey && Boolean(imageDataUrl) && !imageFailed;

  return (
    <div className="mt-1 flex flex-col gap-2 rounded border border-gray-700/80 bg-slate-900/60 px-2 py-1.5 text-xs text-gray-300">
      {showImage && imageDataUrl ? (
        <img
          src={imageDataUrl}
          alt={t('chatPayload.reticulumAttachmentImage', { name: parsed.fileName })}
          className="max-h-64 max-w-full rounded-md border border-cyan-500/20 object-contain"
          onError={() => {
            setImageFailed(true);
          }}
        />
      ) : null}
      <span>{label}</span>
    </div>
  );
}
