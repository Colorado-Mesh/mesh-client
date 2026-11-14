// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { paintTrayUnreadDot, UNREAD_DOT_RGB, UNREAD_DOT_RING_RGB } from './trayUnreadDot';

function pixelAt(bitmap: Buffer, width: number, px: number, py: number): Buffer {
  const idx = (py * width + px) * 4;
  return bitmap.subarray(idx, idx + 4);
}

function expectedPremul(
  colour: { readonly r: number; readonly g: number; readonly b: number },
  alphaByte: number,
): { b: number; g: number; r: number; a: number } {
  return {
    b: Math.round((colour.b * alphaByte) / 255),
    g: Math.round((colour.g * alphaByte) / 255),
    r: Math.round((colour.r * alphaByte) / 255),
    a: alphaByte,
  };
}

describe('paintTrayUnreadDot', () => {
  it('writes BGRA red at the dot centre (regression for #1455)', () => {
    const width = 22;
    const height = 22;
    const bitmap = Buffer.alloc(width * height * 4, 0x7f);
    paintTrayUnreadDot(bitmap, width, height);

    const dotR = Math.max(2, Math.round(width / 8));
    const cx = width - dotR - 2;
    const cy = dotR + 2;
    const [b, g, r, a] = pixelAt(bitmap, width, cx, cy);

    expect(b).toBe(UNREAD_DOT_RGB.b);
    expect(g).toBe(UNREAD_DOT_RGB.g);
    expect(r).toBe(UNREAD_DOT_RGB.r);
    expect(a).toBe(255);
    // Red must not sit at offset 0 (that was the blue #4444EF bug).
    expect(b).not.toBe(UNREAD_DOT_RGB.r);
  });

  it('leaves pixels outside the dot and halo unchanged', () => {
    const width = 22;
    const height = 22;
    const sentinel = 0x7f;
    const bitmap = Buffer.alloc(width * height * 4, sentinel);
    const before = Buffer.from(bitmap);
    paintTrayUnreadDot(bitmap, width, height);

    const dotR = Math.max(2, Math.round(width / 8));
    const cx = width - dotR - 2;
    const cy = dotR + 2;
    const haloR = dotR + 1;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= haloR + 0.5) continue;
        const idx = (py * width + px) * 4;
        expect(bitmap.subarray(idx, idx + 4).equals(before.subarray(idx, idx + 4))).toBe(true);
      }
    }
    expect(bitmap.length).toBe(before.length);
  });

  it('writes premultiplied channels on anti-aliased edges', () => {
    const width = 22;
    const height = 22;
    const bitmap = Buffer.alloc(width * height * 4, 0);
    paintTrayUnreadDot(bitmap, width, height);

    const partial: { b: number; g: number; r: number; a: number }[] = [];
    for (let i = 0; i < bitmap.length; i += 4) {
      const a = bitmap[i + 3];
      if (a > 0 && a < 255) {
        partial.push({ b: bitmap[i], g: bitmap[i + 1], r: bitmap[i + 2], a });
      }
    }
    expect(partial.length).toBeGreaterThan(0);

    for (const px of partial) {
      const asDot = expectedPremul(UNREAD_DOT_RGB, px.a);
      const asRing = expectedPremul(UNREAD_DOT_RING_RGB, px.a);
      const matchesDot = px.b === asDot.b && px.g === asDot.g && px.r === asDot.r;
      const matchesRing = px.b === asRing.b && px.g === asRing.g && px.r === asRing.r;
      expect(matchesDot || matchesRing).toBe(true);
      expect(px.b).toBeLessThanOrEqual(Math.max(UNREAD_DOT_RGB.b, UNREAD_DOT_RING_RGB.b));
      expect(px.g).toBeLessThanOrEqual(Math.max(UNREAD_DOT_RGB.g, UNREAD_DOT_RING_RGB.g));
      expect(px.r).toBeLessThanOrEqual(Math.max(UNREAD_DOT_RGB.r, UNREAD_DOT_RING_RGB.r));
    }
  });

  it.each([16, 22, 44])('places the dot in the top-right for %ipx icons', (size) => {
    const bitmap = Buffer.alloc(size * size * 4, 0);
    paintTrayUnreadDot(bitmap, size, size);

    const painted: { px: number; py: number }[] = [];
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const a = bitmap[(py * size + px) * 4 + 3];
        if (a > 0) painted.push({ px, py });
      }
    }
    expect(painted.length).toBeGreaterThan(0);

    const dotR = Math.max(2, Math.round(size / 8));
    const cx = size - dotR - 2;
    const cy = dotR + 2;
    expect(cx).toBeGreaterThan(size / 2);
    expect(cy).toBeLessThan(size / 2);

    for (const { px, py } of painted) {
      expect(px).toBeGreaterThanOrEqual(0);
      expect(px).toBeLessThan(size);
      expect(py).toBeGreaterThanOrEqual(0);
      expect(py).toBeLessThan(size);
    }
  });

  it('does not throw or write out of bounds for degenerate sizes', () => {
    const tiny = Buffer.alloc(4, 0xaa);
    expect(() => {
      paintTrayUnreadDot(tiny, 1, 1);
    }).not.toThrow();
    expect(tiny.length).toBe(4);

    const two = Buffer.alloc(16, 0xbb);
    expect(() => {
      paintTrayUnreadDot(two, 2, 2);
    }).not.toThrow();
    expect(two.length).toBe(16);

    const undersized = Buffer.alloc(8, 0xcc);
    const undersizedCopy = Buffer.from(undersized);
    expect(() => {
      paintTrayUnreadDot(undersized, 22, 22);
    }).not.toThrow();
    expect(undersized.equals(undersizedCopy)).toBe(true);
  });
});
