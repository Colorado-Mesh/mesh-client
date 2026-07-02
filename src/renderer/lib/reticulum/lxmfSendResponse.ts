import type { ReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';

function isLxmfPayload(value: unknown): value is ReticulumLxmfPayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as ReticulumLxmfPayload;
  return typeof row.sender_hash === 'string' && typeof row.text === 'string';
}

/** Normalize live vs stub LXMF send API shapes to a wire payload. */
export function extractLxmfPayloadFromSendResponse(res: unknown): ReticulumLxmfPayload | null {
  if (!res || typeof res !== 'object') return null;
  const top = res as Record<string, unknown>;
  const messageField = top.message;
  if (isLxmfPayload(messageField)) return messageField;
  if (messageField && typeof messageField === 'object') {
    const nested = (messageField as Record<string, unknown>).message;
    if (isLxmfPayload(nested)) return nested;
  }
  return null;
}
