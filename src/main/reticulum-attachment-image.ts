import fs from 'node:fs/promises';

import { readFileUpTo } from './readFileUpTo';
import { assertReticulumAttachmentPathJailed } from './reticulum-attachment-path';

/** Cap for in-chat attachment image data URLs (local disk; larger than remote link previews). */
export const RETICULUM_ATTACHMENT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED_ATTACHMENT_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

function normalizeMime(mime: string | undefined): string {
  return (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Detect raster image MIME from magic bytes; returns null when unknown. */
export function detectRasterImageMimeFromBytes(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return 'image/bmp';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

export function resolveReticulumAttachmentImageMime(buf: Buffer, mimeHint?: string): string | null {
  const detected = detectRasterImageMimeFromBytes(buf);
  if (detected) return detected;
  const hinted = normalizeMime(mimeHint);
  if (ALLOWED_ATTACHMENT_IMAGE_MIMES.has(hinted)) return hinted;
  return null;
}

/**
 * Read a jailed Reticulum attachment and return a data URL when it is a safe raster image.
 * Rejects SVG and paths outside the attachments directory.
 */
export async function readReticulumAttachmentAsDataUrl(
  filePath: string,
  mimeHint?: string,
): Promise<string | null> {
  const jailed = assertReticulumAttachmentPathJailed(filePath);
  // Ensure the path still exists and is a regular file before streaming.
  const stat = await fs.stat(jailed);
  if (!stat.isFile()) {
    throw new Error('attachment path is not a file');
  }
  const buf = await readFileUpTo(jailed, RETICULUM_ATTACHMENT_IMAGE_MAX_BYTES);
  if (buf.length === 0) return null;
  const mime = resolveReticulumAttachmentImageMime(buf, mimeHint);
  if (!mime) return null;
  return `data:${mime};base64,${buf.toString('base64')}`;
}
