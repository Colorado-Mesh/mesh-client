import { afterEach, describe, expect, it, vi } from 'vitest';

const jsQrMock = vi.hoisted(() => vi.fn());

vi.mock('jsqr', () => ({
  default: jsQrMock,
}));

import { decodeQrFromImageData } from './decodeQrFromImageSource';

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
