import jsQR from 'jsqr';

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

/** Draw a File/Blob image onto a canvas and decode the first QR found. */
export async function decodeQrFromBlob(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return decodeQrFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  } finally {
    bitmap.close();
  }
}

export async function decodeQrFromFile(file: File): Promise<string | null> {
  return decodeQrFromBlob(file);
}
