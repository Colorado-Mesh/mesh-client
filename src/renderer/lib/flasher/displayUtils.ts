/** Display framebuffer → PNG data URL (ported from rnode-flasher). */

export function frameBufferToCanvas(
  framebuffer: number[],
  width: number,
  height: number,
  backgroundColour: string,
  foregroundColour: string,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.fillStyle = backgroundColour;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = foregroundColour;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byteIndex = Math.floor((y * width + x) / 8);
      const bitIndex = x % 8;
      const bit = ((framebuffer[byteIndex] ?? 0) >> (7 - bitIndex)) & 1;
      if (bit) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  return canvas;
}

export function rnodeDisplayBufferToPng(displayBuffer: number[]): string {
  const displayArea = displayBuffer.slice(0, 512);
  const statArea = displayBuffer.slice(512, 1024);

  const displayCanvasOriginal = frameBufferToCanvas(displayArea, 64, 64, '#000000', '#FFFFFF');
  const statCanvasOriginal = frameBufferToCanvas(statArea, 64, 64, '#000000', '#FFFFFF');

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;

  const canvasCtx = canvas.getContext('2d');
  if (!canvasCtx) {
    throw new Error('Canvas 2D context unavailable');
  }
  canvasCtx.imageSmoothingEnabled = false;
  canvasCtx.drawImage(displayCanvasOriginal, 0, 0, 64, 64);
  canvasCtx.drawImage(statCanvasOriginal, 64, 0, 64, 64);

  const scaleFactor = 4;
  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = canvas.width * scaleFactor;
  scaledCanvas.height = canvas.height * scaleFactor;

  const scaledCtx = scaledCanvas.getContext('2d');
  if (!scaledCtx) {
    throw new Error('Canvas 2D context unavailable');
  }
  scaledCtx.imageSmoothingEnabled = false;
  scaledCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

  return scaledCanvas.toDataURL('image/png');
}
