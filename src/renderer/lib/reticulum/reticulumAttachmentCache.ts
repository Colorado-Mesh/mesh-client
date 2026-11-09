import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumCachedAttachment } from '@/shared/reticulumCachedAttachment';

import type { ReticulumLxmfPayload } from '../ingest/reticulumIngest';

type WireAttachment = NonNullable<ReticulumLxmfPayload['attachment']>;

async function cacheOneInboundAttachment(
  fileName: string,
  mimeType: string | undefined,
  dataBase64: string,
): Promise<ReticulumCachedAttachment | null> {
  try {
    const res = await window.electronAPI.chat.saveReticulumAttachment({
      fileName,
      mimeType,
      dataBase64,
      promptSave: false,
    });
    if (!res.success || !res.path) return null;
    return {
      path: res.path,
      fileName,
      mimeType: mimeType || 'application/octet-stream',
    };
  } catch (e) {
    console.warn('[reticulumAttachmentCache] cache failed ' + errLikeToLogString(e));
    return null;
  }
}

/** Persist inbound LXMF attachment bytes under userData (no save dialog). Returns first path. */
export async function cacheReticulumInboundAttachment(
  attachment: WireAttachment,
): Promise<string | null> {
  const all = await cacheReticulumInboundAttachments(attachment);
  return all[0]?.path ?? null;
}

/** Persist all inbound LXMF file attachments (multi-file FIELD_FILE_ATTACHMENTS). */
export async function cacheReticulumInboundAttachments(
  attachment: WireAttachment,
): Promise<ReticulumCachedAttachment[]> {
  const nested = Array.isArray(attachment.attachments) ? attachment.attachments : [];
  const entries =
    nested.length > 0
      ? nested
      : attachment.data_base64
        ? [
            {
              file_name: attachment.file_name,
              mime_type: attachment.mime_type,
              data_base64: attachment.data_base64,
            },
          ]
        : [];
  const out: ReticulumCachedAttachment[] = [];
  for (const entry of entries) {
    const dataBase64 = entry.data_base64;
    if (!dataBase64) continue;
    const cached = await cacheOneInboundAttachment(
      entry.file_name ?? 'attachment',
      entry.mime_type,
      dataBase64,
    );
    if (cached) out.push(cached);
  }
  return out;
}
