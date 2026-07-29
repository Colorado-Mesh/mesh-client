import fs from 'node:fs/promises';

import {
  bufferToRasterImageDataUrl,
  CHAT_INLINE_IMAGE_MAX_BYTES,
  detectRasterImageMimeFromBytes,
  resolveSafeRasterImageMime,
  SAFE_RASTER_IMAGE_MIMES,
} from '../shared/safeRasterImageMime';
import { readFileUpTo } from './readFileUpTo';
import { assertReticulumAttachmentPathJailed } from './reticulum-attachment-path';

/** Cap for in-chat attachment image data URLs (local disk). */
export const RETICULUM_ATTACHMENT_IMAGE_MAX_BYTES = CHAT_INLINE_IMAGE_MAX_BYTES;

/** Max attachment data-URL IPC reads per rolling window. */
export const RETICULUM_ATTACHMENT_IMAGE_RATE_LIMIT_MAX = 30;
export const RETICULUM_ATTACHMENT_IMAGE_RATE_LIMIT_WINDOW_MS = 60_000;

const attachmentImageRateTimestamps: number[] = [];

/** Returns true when a new attachment image read is allowed under the IPC rate limit. */
export function takeReticulumAttachmentImageRateToken(now = Date.now()): boolean {
  const cutoff = now - RETICULUM_ATTACHMENT_IMAGE_RATE_LIMIT_WINDOW_MS;
  while (attachmentImageRateTimestamps.length > 0) {
    const oldest = attachmentImageRateTimestamps[0];
    if (oldest === undefined || oldest >= cutoff) break;
    attachmentImageRateTimestamps.shift();
  }
  if (attachmentImageRateTimestamps.length >= RETICULUM_ATTACHMENT_IMAGE_RATE_LIMIT_MAX) {
    return false;
  }
  attachmentImageRateTimestamps.push(now);
  return true;
}

/** Test helper — clears the IPC rate-limit window. */
export function resetReticulumAttachmentImageRateLimitForTests(): void {
  attachmentImageRateTimestamps.length = 0;
}

export { detectRasterImageMimeFromBytes };

/**
 * Resolve MIME for an attachment embed. Requires magic-byte match — peer-supplied
 * mime hints are not trusted for data-URL construction.
 */
export function resolveReticulumAttachmentImageMime(buf: Buffer): string | null {
  return resolveSafeRasterImageMime(buf, SAFE_RASTER_IMAGE_MIMES);
}

/**
 * Read a jailed Reticulum attachment and return a data URL when it is a safe raster image.
 * Rejects SVG and paths outside the attachments directory. Requires magic-byte MIME match.
 */
export async function readReticulumAttachmentAsDataUrl(
  filePath: string,
  mimeHint?: string,
): Promise<string | null> {
  // mimeHint retained for IPC/API compatibility; magic bytes alone decide embed MIME.
  void mimeHint;
  const jailed = assertReticulumAttachmentPathJailed(filePath);
  // Ensure the path still exists and is a regular file before streaming.
  const stat = await fs.stat(jailed);
  if (!stat.isFile()) {
    throw new Error('attachment path is not a file');
  }
  const buf = await readFileUpTo(jailed, RETICULUM_ATTACHMENT_IMAGE_MAX_BYTES);
  if (buf.length === 0) return null;
  const mime = resolveReticulumAttachmentImageMime(buf);
  if (!mime) return null;
  return bufferToRasterImageDataUrl(buf, mime);
}
