import { useTranslation } from 'react-i18next';

import {
  isReticulumAudioAttachment,
  isReticulumImageAttachment,
  parseReticulumAttachmentPayload,
} from '@/renderer/lib/reticulum/parseReticulumAttachmentPayload';

export interface ReticulumAttachmentLineProps {
  payload: string;
}

/** Read-only label for historic LXMF `[file:name:mime]` payloads (send UI deferred). */
export function ReticulumAttachmentLine({ payload }: ReticulumAttachmentLineProps) {
  const { t } = useTranslation();
  const parsed = parseReticulumAttachmentPayload(payload);
  if (!parsed) return null;

  const mimeType = parsed.mimeType;
  const label = isReticulumImageAttachment(mimeType)
    ? t('chatPanel.reticulumImageAttachment', { name: parsed.fileName })
    : isReticulumAudioAttachment(mimeType)
      ? t('chatPanel.reticulumAudioAttachment', { name: parsed.fileName })
      : t('chatPanel.reticulumFileAttachment', { name: parsed.fileName });

  return (
    <div className="mt-1 flex flex-col gap-2 rounded border border-gray-700/80 bg-slate-900/60 px-2 py-1.5 text-xs text-gray-300">
      <span>{label}</span>
    </div>
  );
}
