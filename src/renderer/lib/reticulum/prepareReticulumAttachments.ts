import {
  RETICULUM_ATTACHMENT_MAX_FILES,
  RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES,
  RETICULUM_IMAGE_MAX_BYTES,
  RETICULUM_PHOTO_SOURCE_MAX_BYTES,
  type ReticulumAttachmentErrorCode,
  reticulumImageMimeFromWireFormat,
  type ReticulumImageWireFormat,
  reticulumImageWireFormatFromMime,
  sanitizeReticulumAttachmentFileName,
  sniffReticulumImageWireFormat,
} from '@/shared/reticulum-attachment-types';

import { encodePhotoForLxmf } from './reticulumPhotoEncode';

export type PrepareAttachmentError =
  | ReticulumAttachmentErrorCode
  | 'photo_unsupported'
  | 'photo_decode_failed'
  | 'read_failed'
  | 'no_files';

export interface PreparedFileAttachment {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface PreparedPhotoAttachment {
  fileName: string;
  format: ReticulumImageWireFormat;
  mimeType: string;
  bytes: Uint8Array;
}

export type PreparedReticulumAttachments =
  | { kind: 'files'; files: PreparedFileAttachment[] }
  | { kind: 'photo'; photo: PreparedPhotoAttachment };

export type PrepareResult =
  | { ok: true; prepared: PreparedReticulumAttachments }
  | { ok: false; error: PrepareAttachmentError };

export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => {
      reject(reader.error ?? new Error('read_failed'));
    };
    reader.onload = () => {
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Validate (count/size) and read generic files for `FIELD_FILE_ATTACHMENTS`.
 * Limits are checked from `File.size` before reading so oversize picks never load into memory.
 */
export async function prepareReticulumFileAttachments(
  files: readonly File[],
): Promise<PrepareResult> {
  if (files.length === 0) return { ok: false, error: 'no_files' };
  if (files.length > RETICULUM_ATTACHMENT_MAX_FILES) {
    return { ok: false, error: 'attachment_count_exceeded' };
  }
  let total = 0;
  for (const f of files) {
    if (f.size === 0) return { ok: false, error: 'attachment_empty' };
    total += f.size;
    if (total > RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES) {
      return { ok: false, error: 'attachment_too_large' };
    }
  }
  const out: PreparedFileAttachment[] = [];
  try {
    for (const f of files) {
      const bytes = await readBlobBytes(f);
      if (bytes.length === 0) return { ok: false, error: 'attachment_empty' };
      out.push({
        fileName: sanitizeReticulumAttachmentFileName(f.name),
        mimeType: f.type || 'application/octet-stream',
        bytes,
      });
    }
  } catch (e) {
    console.warn('[prepareReticulumAttachments] read failed:', e);
    return { ok: false, error: 'read_failed' };
  }
  return { ok: true, prepared: { kind: 'files', files: out } };
}

/**
 * Prepare a photo for native `FIELD_IMAGE`: raster only (no SVG/HEIC), metadata stripped and
 * downscaled to fit {@link RETICULUM_IMAGE_MAX_BYTES} when a canvas is available; GIFs and
 * canvas-less environments pass through when already under the cap and magic-byte verified.
 */
export async function prepareReticulumPhotoAttachment(file: File): Promise<PrepareResult> {
  if (file.size === 0) return { ok: false, error: 'attachment_empty' };
  if (file.size > RETICULUM_PHOTO_SOURCE_MAX_BYTES) {
    return { ok: false, error: 'image_too_large' };
  }
  const declared = reticulumImageWireFormatFromMime(file.type);
  if (!declared && !file.type.toLowerCase().startsWith('image/')) {
    return { ok: false, error: 'photo_unsupported' };
  }
  let raw: Uint8Array;
  try {
    raw = await readBlobBytes(file);
  } catch (e) {
    console.warn('[prepareReticulumAttachments] photo read failed:', e);
    return { ok: false, error: 'read_failed' };
  }
  const sniffed = sniffReticulumImageWireFormat(raw);
  if (!sniffed) return { ok: false, error: 'photo_unsupported' };

  const baseName =
    sanitizeReticulumAttachmentFileName(file.name).replace(/\.[^.]*$/, '') || 'photo';
  const passThrough = (): PrepareResult => {
    if (raw.length > RETICULUM_IMAGE_MAX_BYTES) return { ok: false, error: 'image_too_large' };
    const ext = sniffed === 'jpeg' ? 'jpg' : sniffed;
    return {
      ok: true,
      prepared: {
        kind: 'photo',
        photo: {
          fileName: `${baseName}.${ext}`,
          format: sniffed,
          mimeType: reticulumImageMimeFromWireFormat(sniffed),
          bytes: raw,
        },
      },
    };
  };

  // Animated GIFs stay GIFs; everything else is re-encoded (strips EXIF/GPS, fits the cap).
  if (sniffed === 'gif') return passThrough();
  const encoded = await encodePhotoForLxmf(file, RETICULUM_IMAGE_MAX_BYTES);
  if (encoded.status === 'unavailable') return passThrough();
  if (encoded.status === 'failed') return { ok: false, error: 'photo_decode_failed' };
  return {
    ok: true,
    prepared: {
      kind: 'photo',
      photo: {
        fileName: `${baseName}.jpg`,
        format: 'jpeg',
        mimeType: 'image/jpeg',
        bytes: encoded.bytes,
      },
    },
  };
}
