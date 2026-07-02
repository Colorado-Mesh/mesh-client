import { app } from 'electron';
import path from 'path';

/** Canonical inbound attachment directory under Electron userData. */
export function getReticulumAttachmentsDir(): string {
  return path.join(app.getPath('userData'), 'reticulum', 'attachments');
}

export function isReticulumAttachmentPathJailed(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const dir = path.resolve(getReticulumAttachmentsDir());
  return resolved === dir || resolved.startsWith(`${dir}${path.sep}`);
}

export function assertReticulumAttachmentPathJailed(filePath: string): string {
  const resolved = path.resolve(filePath);
  if (!isReticulumAttachmentPathJailed(resolved)) {
    throw new Error('attachment path outside reticulum attachments directory');
  }
  return resolved;
}

export function sanitizeReticulumAttachmentPathForDb(
  attachmentPath: string | null | undefined,
): string | null {
  if (typeof attachmentPath !== 'string' || !attachmentPath.trim()) return null;
  const trimmed = attachmentPath.trim().slice(0, 512);
  if (!isReticulumAttachmentPathJailed(trimmed)) return null;
  return path.resolve(trimmed);
}
