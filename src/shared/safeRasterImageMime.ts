/** Shared max for chat inline images (remote link previews + local Reticulum attachments). */
export const CHAT_INLINE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Raster MIME types safe for `<img src={data:...}>` embeds.
 * Excludes SVG (XML + script/event handlers) and icon types unless callers opt in.
 */
export const SAFE_RASTER_IMAGE_MIMES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
]);

/** Link-preview allowlist: raster + favicon types (still no SVG). */
export const LINK_PREVIEW_IMAGE_MIMES: ReadonlySet<string> = new Set([
  ...SAFE_RASTER_IMAGE_MIMES,
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

/** Base MIME from a Content-Type header (strips `; charset=…`). */
export function baseMimeFromContentType(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function asciiSlice(buf: Uint8Array | Buffer, start: number, end: number): string {
  return Buffer.from(buf.subarray(start, end)).toString('ascii');
}

/** Detect raster image MIME from magic bytes; returns null when unknown. */
export function detectRasterImageMimeFromBytes(buf: Uint8Array | Buffer): string | null {
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
    const head = asciiSlice(buf, 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (buf.length >= 12 && asciiSlice(buf, 0, 4) === 'RIFF' && asciiSlice(buf, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return 'image/bmp';
  }
  if (buf.length >= 12 && asciiSlice(buf, 4, 8) === 'ftyp') {
    const brand = asciiSlice(buf, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  return null;
}

/**
 * Resolve MIME for an inline embed: require magic-byte match.
 * Peer-supplied Content-Type / LXMF mime hints are not trusted for construction.
 */
export function resolveSafeRasterImageMime(
  buf: Uint8Array | Buffer,
  allowlist: ReadonlySet<string> = SAFE_RASTER_IMAGE_MIMES,
): string | null {
  const detected = detectRasterImageMimeFromBytes(buf);
  if (detected && allowlist.has(detected)) return detected;
  return null;
}

/** Build a `data:` URL for a verified raster buffer. */
export function bufferToRasterImageDataUrl(buf: Uint8Array | Buffer, mime: string): string {
  const b64 =
    typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)
      ? buf.toString('base64')
      : Buffer.from(buf).toString('base64');
  return `data:${mime};base64,${b64}`;
}
