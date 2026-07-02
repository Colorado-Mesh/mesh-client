import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import type { ReticulumLxmfPayload } from '../ingest/reticulumIngest';

/** Persist inbound LXMF attachment bytes under userData (no save dialog). */
export async function cacheReticulumInboundAttachment(
  attachment: NonNullable<ReticulumLxmfPayload['attachment']>,
): Promise<string | null> {
  const dataBase64 = attachment.data_base64;
  const fileName = attachment.file_name ?? 'attachment';
  if (!dataBase64) return null;
  try {
    const res = await window.electronAPI.chat.saveReticulumAttachment({
      fileName,
      mimeType: attachment.mime_type,
      dataBase64,
      promptSave: false,
    });
    return res.success && res.path ? res.path : null;
  } catch (e) {
    console.warn('[reticulumAttachmentCache] cache failed ' + errLikeToLogString(e));
    return null;
  }
}
