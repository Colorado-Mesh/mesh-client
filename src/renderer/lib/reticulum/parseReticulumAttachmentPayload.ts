/** Parse LXMF resource marker `[file:name:mime]` from message text. */
export function parseReticulumAttachmentPayload(
  payload: string,
): { fileName: string; mimeType: string } | null {
  const m = /^\[file:([^:\]]+):([^\]]+)\]$/.exec(payload.trim());
  if (!m) return null;
  return { fileName: m[1], mimeType: m[2] };
}

export function isReticulumImageAttachment(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
