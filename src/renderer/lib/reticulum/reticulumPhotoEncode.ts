export type PhotoEncodeResult =
  { status: 'ok'; bytes: Uint8Array } | { status: 'unavailable' } | { status: 'failed' };

/** Longest edge tried first; each retry shrinks by {@link SCALE_STEP}. */
const START_MAX_EDGE = 1600;
const MIN_EDGE = 160;
const SCALE_STEP = 0.75;
const JPEG_QUALITIES = [0.85, 0.72, 0.6, 0.48] as const;

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

/**
 * Decode `file` and re-encode as JPEG ≤ `maxBytes` (white-flattened alpha, metadata dropped).
 * `unavailable` when the DOM lacks `createImageBitmap` / canvas (e.g. jsdom).
 */
export async function encodePhotoForLxmf(file: Blob, maxBytes: number): Promise<PhotoEncodeResult> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { status: 'unavailable' };
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    console.warn('[reticulumPhotoEncode] decode failed:', e);
    return { status: 'failed' };
  }
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return { status: 'unavailable' };
    let edge = Math.min(START_MAX_EDGE, Math.max(bitmap.width, bitmap.height));
    while (edge >= MIN_EDGE) {
      const scale = edge / Math.max(bitmap.width, bitmap.height);
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const q of JPEG_QUALITIES) {
        const blob = await canvasToJpegBlob(canvas, q);
        if (blob && blob.size > 0 && blob.size <= maxBytes) {
          return { status: 'ok', bytes: new Uint8Array(await blob.arrayBuffer()) };
        }
      }
      edge = Math.floor(edge * SCALE_STEP);
    }
    return { status: 'failed' };
  } finally {
    bitmap.close();
  }
}
