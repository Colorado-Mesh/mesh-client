import { app } from 'electron';

import { assertPathInsideRoot, isPathInsideRoot, joinUnderRoot } from '../shared/pathUnderRoot';

/** Canonical inbound attachment directory under Electron userData. */
export function getReticulumAttachmentsDir(): string {
  return joinUnderRoot(app.getPath('userData'), 'reticulum', 'attachments');
}

export function isReticulumAttachmentPathJailed(filePath: string): boolean {
  return isPathInsideRoot(getReticulumAttachmentsDir(), filePath);
}

export function assertReticulumAttachmentPathJailed(filePath: string): string {
  try {
    return assertPathInsideRoot(getReticulumAttachmentsDir(), filePath);
  } catch {
    throw new Error('attachment path outside reticulum attachments directory');
  }
}

export function sanitizeReticulumAttachmentPathForDb(
  attachmentPath: string | null | undefined,
): string | null {
  if (typeof attachmentPath !== 'string' || !attachmentPath.trim()) return null;
  const trimmed = attachmentPath.trim().slice(0, 512);
  try {
    return assertReticulumAttachmentPathJailed(trimmed);
  } catch {
    // catch-no-log-ok invalid attachment paths are dropped from DB writes
    return null;
  }
}
