import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isReticulumAudioAttachment,
  isReticulumImageAttachment,
  parseReticulumAttachmentPayload,
} from '@/renderer/lib/reticulum/parseReticulumAttachmentPayload';

export interface ReticulumAttachmentLineProps {
  payload: string;
  attachmentPath?: string | null;
  /** Base64 payload when file is not yet saved locally. */
  attachmentDataBase64?: string | null;
  attachmentMimeType?: string | null;
}

export function ReticulumAttachmentLine({
  payload,
  attachmentPath,
  attachmentDataBase64,
  attachmentMimeType,
}: ReticulumAttachmentLineProps) {
  const { t } = useTranslation();
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const parsed = parseReticulumAttachmentPayload(payload);
  if (!parsed) return null;

  const mimeType = attachmentMimeType ?? parsed.mimeType;
  const isAudio = isReticulumAudioAttachment(mimeType);

  const showInFolder = () => {
    if (!attachmentPath) return;
    void window.electronAPI.chat.showItemInFolder(attachmentPath);
  };

  const saveAttachment = async () => {
    if (!attachmentDataBase64) return;
    try {
      const res = await window.electronAPI.chat.saveReticulumAttachment({
        fileName: parsed.fileName,
        mimeType,
        dataBase64: attachmentDataBase64,
        promptSave: true,
      });
      if (res.success && res.path) {
        void window.electronAPI.chat.showItemInFolder(res.path);
      }
    } catch (e) {
      console.warn('[ReticulumAttachmentLine] save ' + errLikeToLogString(e));
    }
  };

  const ensureAudioSrc = () => {
    if (audioSrc) return;
    if (attachmentPath) {
      setAudioSrc(`file://${attachmentPath}`);
      return;
    }
    if (attachmentDataBase64) {
      setAudioSrc(`data:${mimeType};base64,${attachmentDataBase64}`);
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-2 rounded border border-gray-700/80 bg-slate-900/60 px-2 py-1.5 text-xs text-gray-300">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          {isReticulumImageAttachment(mimeType)
            ? t('chatPanel.reticulumImageAttachment', { name: parsed.fileName })
            : isAudio
              ? t('chatPanel.reticulumAudioAttachment', { name: parsed.fileName })
              : t('chatPanel.reticulumFileAttachment', { name: parsed.fileName })}
        </span>
        {attachmentPath ? (
          <button
            type="button"
            className="text-amber-400 hover:underline"
            onClick={showInFolder}
            aria-label={t('chatPanel.reticulumShowInFolder')}
          >
            {t('chatPanel.reticulumShowInFolder')}
          </button>
        ) : attachmentDataBase64 ? (
          <button
            type="button"
            className="text-amber-400 hover:underline"
            onClick={() => {
              void saveAttachment();
            }}
            aria-label={t('chatPanel.reticulumSaveAttachment')}
          >
            {t('chatPanel.reticulumSaveAttachment')}
          </button>
        ) : null}
      </div>
      {isAudio ? (
        // User-recorded voice clips have no transcript; aria-label on <audio> covers purpose.
        // eslint-disable-next-line jsx-a11y/media-has-caption -- no captions for LXMF voice attachments
        <audio
          controls
          preload="none"
          className="max-w-full"
          src={audioSrc ?? undefined}
          onPlay={ensureAudioSrc}
          aria-label={t('chatPanel.reticulumAudioAttachment', { name: parsed.fileName })}
        />
      ) : null}
    </div>
  );
}
