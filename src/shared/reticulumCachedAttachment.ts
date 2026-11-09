/** One jailed on-disk LXMF file attachment (outbound cache or inbound decode). */
export interface ReticulumCachedAttachment {
  path: string;
  fileName: string;
  mimeType: string;
}

/** Serialize for SQLite `attachments_json` / IPC. */
export function serializeReticulumCachedAttachments(
  items: readonly ReticulumCachedAttachment[] | null | undefined,
): string | null {
  if (!items || items.length === 0) return null;
  return JSON.stringify(items);
}

/** Parse SQLite `attachments_json`; returns [] on missing/invalid. */
export function parseReticulumCachedAttachmentsJson(
  raw: string | null | undefined,
): ReticulumCachedAttachment[] {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ReticulumCachedAttachment[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const path = typeof rec.path === 'string' ? rec.path : '';
      const fileName = typeof rec.fileName === 'string' ? rec.fileName : '';
      const mimeType = typeof rec.mimeType === 'string' ? rec.mimeType : 'application/octet-stream';
      if (!path || !fileName) continue;
      out.push({ path, fileName, mimeType });
    }
    return out;
  } catch {
    return [];
  }
}
