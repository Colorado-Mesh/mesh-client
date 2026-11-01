/**
 * Shared LXMF file / photo attachment types and the safe-receive policy.
 *
 * Wire: native LXMF `FIELD_FILE_ATTACHMENTS` (0x05) `[[name, bytes], …]` and `FIELD_IMAGE`
 * (0x06) `[format, bytes]` — Ratspeak / rsLXMF / Sideband parity. This is **not** rncp (Remote
 * tab Link transfer, `ChatDmRncpControl`).
 *
 * Keep limits in sync with `reticulum-sidecar/src/stack/lxmf_attachments.rs`.
 */

/** Sidecar HTTP paths (generic `proxyPost` / `proxyGet`). */
export const LXMF_SEND_API_PATH = '/api/v1/lxmf/send';
export const lxmfMessageCancelApiPath = (messageHash: string): string =>
  `/api/v1/lxmf/messages/${encodeURIComponent(messageHash)}/cancel`;
export const lxmfMessageProgressApiPath = (messageHash: string): string =>
  `/api/v1/lxmf/messages/${encodeURIComponent(messageHash)}/progress`;

/** Max files per message. */
export const RETICULUM_ATTACHMENT_MAX_FILES = 4;
/** Combined raw bytes (one `FIELD_FILE_ATTACHMENTS` value under lxmf-core's 256 KiB field cap). */
export const RETICULUM_ATTACHMENT_MAX_TOTAL_BYTES = 240 * 1024;
/** Raw bytes for a `FIELD_IMAGE` photo. */
export const RETICULUM_IMAGE_MAX_BYTES = 240 * 1024;
/** Longest accepted source photo before downscale (guards renderer memory). */
export const RETICULUM_PHOTO_SOURCE_MAX_BYTES = 25 * 1024 * 1024;
/** File-name cap after sanitisation (chars). */
export const RETICULUM_ATTACHMENT_NAME_MAX_CHARS = 96;

/** Native LXMF image formats the sidecar accepts for `FIELD_IMAGE`. */
export type ReticulumImageWireFormat = 'png' | 'jpeg' | 'webp' | 'gif';

export interface LxmfFileAttachmentWire {
  file_name: string;
  data_base64: string;
}

export interface LxmfImageWire {
  format: ReticulumImageWireFormat;
  data_base64: string;
}

/** Stable sidecar error prefixes (text before the first `:`). */
export type ReticulumAttachmentErrorCode =
  | 'attachment_count_exceeded'
  | 'attachment_too_large'
  | 'attachment_empty'
  | 'attachment_base64_decode'
  | 'image_too_large'
  | 'image_format_unsupported'
  | 'image_magic_mismatch'
  | 'image_base64_decode'
  | 'cancelled';

const KNOWN_ATTACHMENT_ERROR_CODES: ReadonlySet<string> = new Set<ReticulumAttachmentErrorCode>([
  'attachment_count_exceeded',
  'attachment_too_large',
  'attachment_empty',
  'attachment_base64_decode',
  'image_too_large',
  'image_format_unsupported',
  'image_magic_mismatch',
  'image_base64_decode',
  'cancelled',
]);

/** Extract a known attachment error code from a sidecar `error` string (or thrown message). */
export function parseReticulumAttachmentErrorCode(
  error: string | null | undefined,
): ReticulumAttachmentErrorCode | null {
  if (!error) return null;
  for (const raw of error.split(/[\s:]+/)) {
    if (KNOWN_ATTACHMENT_ERROR_CODES.has(raw)) return raw as ReticulumAttachmentErrorCode;
  }
  return null;
}

// ── Safe-receive / safe-send file name policy ────────────────────────────────────────────────

/**
 * Extensions that run code or install software when opened. They are never auto-opened;
 * received copies are quarantined (`reticulum/attachments/quarantine/*.quarantine`, mode 0600)
 * and can only be saved explicitly.
 */
export const RISKY_ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  'app',
  'appimage',
  'apk',
  'bat',
  'cmd',
  'com',
  'command',
  'cpl',
  'desktop',
  'dll',
  'dmg',
  'exe',
  'hta',
  'jar',
  'js',
  'jse',
  'lnk',
  'msi',
  'msp',
  'pif',
  'pkg',
  'ps1',
  'reg',
  'scr',
  'sh',
  'url',
  'vb',
  'vbe',
  'vbs',
  'workflow',
  'wsf',
  'wsh',
]);

/** Suffix appended to quarantined risky files so they cannot be double-click executed. */
export const RETICULUM_QUARANTINE_SUFFIX = '.quarantine';
/** Sub-directory of `reticulum/attachments/` holding quarantined files (inside the path jail). */
export const RETICULUM_QUARANTINE_DIRNAME = 'quarantine';

const WINDOWS_RESERVED_STEMS: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * Neutralise an attachment file name (mirror of `sanitize_attachment_file_name` in the sidecar):
 * drop directories, control + bidi-override chars and chat-marker delimiters (`[` `]` `:`),
 * trim leading dots, avoid Windows device names, cap length keeping a short extension.
 */
export function sanitizeReticulumAttachmentFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? raw).trim();
  let cleaned = '';
  for (const ch of base) {
    const cp = ch.codePointAt(0) ?? 0;
    const isControl = cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
    const isBidi =
      cp === 0x200e ||
      cp === 0x200f ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069);
    cleaned += isControl || isBidi || '[]:<>"|?*'.includes(ch) ? '_' : ch;
  }
  cleaned = cleaned
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (!cleaned) return 'attachment';
  const stem = (cleaned.split('.')[0] ?? '').toUpperCase();
  if (WINDOWS_RESERVED_STEMS.has(stem)) cleaned = `_${cleaned}`;
  const chars = Array.from(cleaned);
  if (chars.length > RETICULUM_ATTACHMENT_NAME_MAX_CHARS) {
    const dot = cleaned.lastIndexOf('.');
    const ext = dot >= 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : '';
    const keep = Math.max(1, RETICULUM_ATTACHMENT_NAME_MAX_CHARS - Array.from(ext).length);
    cleaned = `${chars.slice(0, keep).join('')}${ext}`;
  }
  return cleaned;
}

/** Lower-case extension without the dot (`''` when none). */
export function reticulumAttachmentExtension(fileName: string): string {
  const name = sanitizeReticulumAttachmentFileName(fileName);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * True when the extension (or any dotted segment, e.g. `report.pdf.exe`) can execute on open.
 */
export function isRiskyReticulumAttachmentFileName(fileName: string): boolean {
  const name = sanitizeReticulumAttachmentFileName(fileName).toLowerCase();
  const segments = name.split('.').slice(1);
  return segments.some((seg) => RISKY_ATTACHMENT_EXTENSIONS.has(seg));
}

/** Where an inbound attachment is cached: name + whether it is quarantined. */
export interface ReticulumAttachmentStorePlan {
  /** Sanitised name (+ `.quarantine` when risky). */
  fileName: string;
  /** Sub-directory under `reticulum/attachments/` (`''` or `quarantine`). */
  subdir: '' | typeof RETICULUM_QUARANTINE_DIRNAME;
  quarantined: boolean;
}

export function planReticulumAttachmentStore(rawFileName: string): ReticulumAttachmentStorePlan {
  const safe = sanitizeReticulumAttachmentFileName(rawFileName).replace(/[^\w.\- ]+/g, '_');
  if (isRiskyReticulumAttachmentFileName(safe)) {
    return {
      fileName: `${safe}${RETICULUM_QUARANTINE_SUFFIX}`.slice(
        -(RETICULUM_ATTACHMENT_NAME_MAX_CHARS + RETICULUM_QUARANTINE_SUFFIX.length),
      ),
      subdir: RETICULUM_QUARANTINE_DIRNAME,
      quarantined: true,
    };
  }
  return { fileName: safe, subdir: '', quarantined: false };
}

// ── Image wire formats ───────────────────────────────────────────────────────────────────────

const IMAGE_MIME_TO_WIRE: Readonly<Record<string, ReticulumImageWireFormat>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Map a MIME type to a native `FIELD_IMAGE` format token (null when unsupported, e.g. SVG/HEIC). */
export function reticulumImageWireFormatFromMime(mime: string): ReticulumImageWireFormat | null {
  const base = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  return IMAGE_MIME_TO_WIRE[base] ?? null;
}

/** Sniff `FIELD_IMAGE` format from magic bytes (null when not a supported raster). */
export function sniffReticulumImageWireFormat(bytes: Uint8Array): ReticulumImageWireFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) {
    return 'png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** Display MIME for a wire image format. */
export function reticulumImageMimeFromWireFormat(format: ReticulumImageWireFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}
