import jsQR from 'jsqr';

/** Reject blobs larger than this before decode (compressed image bomb guard). */
export const QR_DECODE_MAX_BYTES = 12 * 1024 * 1024;

/** Cap decoded bitmap dimensions before getImageData. */
export const QR_DECODE_MAX_DIMENSION = 2048;

/**
 * Decode a QR payload from ImageData (canvas / video frame).
 * Returns null when no code is found (expected while scanning).
 */
export function decodeQrFromImageData(imageData: ImageData): string | null {
  const code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  const text = code?.data?.trim();
  return text ? text : null;
}

function assertDecodableBlob(blob: Blob): void {
  if (blob.size > QR_DECODE_MAX_BYTES) {
    throw new Error('qr_image_too_large');
  }
}

/** Draw a File/Blob image onto a canvas and decode the first QR found. */
export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  assertDecodableBlob(blob);
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, QR_DECODE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height, 1));
    const width = Math.max(1, Math.floor(bitmap.width * scale));
    const height = Math.max(1, Math.floor(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    return decodeQrFromImageData(ctx.getImageData(0, 0, width, height));
  } finally {
    bitmap.close();
  }
}

export async function decodeQrFromFile(file: File): Promise<string | null> {
  return decodeQrFromBlob(file);
}
