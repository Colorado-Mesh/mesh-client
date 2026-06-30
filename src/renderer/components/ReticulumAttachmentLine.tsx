import { useTranslation } from 'react-i18next';

import {
  isReticulumImageAttachment,
  parseReticulumAttachmentPayload,
} from '@/renderer/lib/reticulum/parseReticulumAttachmentPayload';

export interface ReticulumAttachmentLineProps {
  payload: string;
  attachmentPath?: string | null;
}

export function ReticulumAttachmentLine({ payload, attachmentPath }: ReticulumAttachmentLineProps) {
  const { t } = useTranslation();
  const parsed = parseReticulumAttachmentPayload(payload);
  if (!parsed) return null;

  const showInFolder = () => {
    if (!attachmentPath) return;
    void window.electronAPI.chat.showItemInFolder(attachmentPath);
  };

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 rounded border border-gray-700/80 bg-slate-900/60 px-2 py-1.5 text-xs text-gray-300">
      <span>
        {isReticulumImageAttachment(parsed.mimeType)
          ? t('chatPanel.reticulumImageAttachment', { name: parsed.fileName })
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
      ) : null}
    </div>
  );
}
