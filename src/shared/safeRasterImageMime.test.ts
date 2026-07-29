import { describe, expect, it } from 'vitest';

import {
  baseMimeFromContentType,
  bufferToRasterImageDataUrl,
  detectRasterImageMimeFromBytes,
  LINK_PREVIEW_IMAGE_MIMES,
  resolveSafeRasterImageMime,
  SAFE_RASTER_IMAGE_MIMES,
} from './safeRasterImageMime';

describe('baseMimeFromContentType', () => {
  it('strips parameters and lowercases', () => {
    expect(baseMimeFromContentType('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(baseMimeFromContentType('Image/PNG')).toBe('image/png');
    expect(baseMimeFromContentType(undefined)).toBe('');
  });
});

describe('detectRasterImageMimeFromBytes', () => {
  it('detects JPEG / PNG / GIF / WebP / BMP', () => {
    expect(detectRasterImageMimeFromBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectRasterImageMimeFromBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(detectRasterImageMimeFromBytes(Buffer.from('GIF89a'))).toBe('image/gif');
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    expect(detectRasterImageMimeFromBytes(webp)).toBe('image/webp');
    expect(detectRasterImageMimeFromBytes(Buffer.from([0x42, 0x4d, 0x00]))).toBe('image/bmp');
  });

  it('detects AVIF ftyp brand', () => {
    const avif = Buffer.alloc(12);
    avif.write('....', 0);
    avif.write('ftyp', 4);
    avif.write('avif', 8);
    expect(detectRasterImageMimeFromBytes(avif)).toBe('image/avif');
  });

  it('detects ICO magic bytes', () => {
    expect(detectRasterImageMimeFromBytes(Buffer.from([0x00, 0x00, 0x01, 0x00]))).toBe(
      'image/x-icon',
    );
    expect(
      resolveSafeRasterImageMime(Buffer.from([0x00, 0x00, 0x01, 0x00]), LINK_PREVIEW_IMAGE_MIMES),
    ).toBe('image/x-icon');
    expect(resolveSafeRasterImageMime(Buffer.from([0x00, 0x00, 0x01, 0x00]))).toBeNull();
  });

  it('returns null for unknown / SVG-like bytes', () => {
    expect(detectRasterImageMimeFromBytes(Buffer.from('<svg xmlns'))).toBeNull();
    expect(detectRasterImageMimeFromBytes(Buffer.alloc(0))).toBeNull();
  });
});

describe('resolveSafeRasterImageMime', () => {
  it('requires magic bytes and ignores allowlisted hint-only paths', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(resolveSafeRasterImageMime(png)).toBe('image/png');
    expect(resolveSafeRasterImageMime(Buffer.from('not an image'))).toBeNull();
  });

  it('rejects detected MIME outside the allowlist', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(resolveSafeRasterImageMime(jpeg, new Set(['image/png']))).toBeNull();
  });
});

describe('bufferToRasterImageDataUrl', () => {
  it('encodes base64 data URL', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bufferToRasterImageDataUrl(png, 'image/png')).toBe(
      `data:image/png;base64,${png.toString('base64')}`,
    );
  });
});

describe('allowlists', () => {
  it('link preview includes icon types; attachment set does not', () => {
    expect(LINK_PREVIEW_IMAGE_MIMES.has('image/x-icon')).toBe(true);
    expect(SAFE_RASTER_IMAGE_MIMES.has('image/x-icon')).toBe(false);
    expect(SAFE_RASTER_IMAGE_MIMES.has('image/svg+xml')).toBe(false);
  });
});
