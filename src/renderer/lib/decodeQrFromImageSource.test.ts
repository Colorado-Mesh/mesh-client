/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const jsQrMock = vi.hoisted(() => vi.fn());

vi.mock('jsqr', () => ({
  default: jsQrMock,
}));

import {
  decodeQrFromBlob,
  decodeQrFromImageData,
  QR_DECODE_MAX_BYTES,
} from './decodeQrFromImageSource';

function fakeImageData(width: number, height: number): ImageData {
  return {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height,
    colorSpace: 'srgb',
  };
}

describe('decodeQrFromImageData', () => {
  afterEach(() => {
    jsQrMock.mockReset();
  });

  it('returns trimmed payload when jsQR finds a code', () => {
    jsQrMock.mockReturnValue({ data: '  lxm://contact/abcd  ' });
    const data = fakeImageData(2, 2);
    expect(decodeQrFromImageData(data)).toBe('lxm://contact/abcd');
    expect(jsQrMock).toHaveBeenCalledWith(data.data, 2, 2, { inversionAttempts: 'attemptBoth' });
  });

  it('returns null when no code is present', () => {
    jsQrMock.mockReturnValue(null);
    expect(decodeQrFromImageData(fakeImageData(1, 1))).toBeNull();
  });
});

describe('decodeQrFromBlob', () => {
  afterEach(() => {
    jsQrMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects oversized blobs before decoding', async () => {
    const blob = { size: QR_DECODE_MAX_BYTES + 1 } as Blob;
    await expect(decodeQrFromBlob(blob)).rejects.toThrow('qr_image_too_large');
  });

  it('decodes via createImageBitmap and closes the bitmap', async () => {
    jsQrMock.mockReturnValue({ data: 'ok' });
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4, height: 4, close }));
    const getImageData = vi.fn().mockReturnValue(fakeImageData(4, 4));
    const drawImage = vi.fn();
    const getContext = vi.fn().mockReturnValue({ drawImage, getImageData });
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext,
    } as unknown as HTMLCanvasElement);

    const text = await decodeQrFromBlob(
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    );
    expect(text).toBe('ok');
    expect(close).toHaveBeenCalled();
  });
});
