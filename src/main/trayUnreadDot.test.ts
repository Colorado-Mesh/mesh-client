// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { paintTrayUnreadDot, UNREAD_DOT_RGB, UNREAD_DOT_RING_RGB } from './trayUnreadDot';

function pixelAt(bitmap: Buffer, width: number, px: number, py: number): Buffer {
  const idx = (py * width + px) * 4;
  return bitmap.subarray(idx, idx + 4);
}

/** Mirror blendPremulOver for expected-value checks. */
function expectedAfterBlend(
  dst: { b: number; g: number; r: number; a: number },
  colour: { readonly r: number; readonly g: number; readonly b: number },
  coverage: number,
): { b: number; g: number; r: number; a: number } {
  const sa = Math.max(0, Math.min(1, coverage));
  const srcA = Math.round(sa * 255);
  const srcB = Math.round((colour.b * srcA) / 255);
  const srcG = Math.round((colour.g * srcA) / 255);
  const srcR = Math.round((colour.r * srcA) / 255);
  const invA = 255 - srcA;
  return {
    b: srcB + Math.round((dst.b * invA) / 255),
    g: srcG + Math.round((dst.g * invA) / 255),
    r: srcR + Math.round((dst.r * invA) / 255),
    a: srcA + Math.round((dst.a * invA) / 255),
  };
}

describe('paintTrayUnreadDot', () => {
  it('writes BGRA red at the dot centre (regression for #1455)', () => {
    const width = 22;
    const height = 22;
    const bitmap = Buffer.alloc(width * height * 4, 0);
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
    const bitmap = Buffer.alloc(width * height * 4, 0x7f);
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

  it('blends halo then dot at the anti-aliased boundary (20, 5) on 22×22', () => {
    const width = 22;
    const height = 22;
    const bitmap = Buffer.alloc(width * height * 4, 0);
    paintTrayUnreadDot(bitmap, width, height);

    const dotR = Math.max(2, Math.round(width / 8));
    const cx = width - dotR - 2;
    const cy = dotR + 2;
    const haloR = dotR + 1;
    expect(cx).toBe(17);
    expect(cy).toBe(5);
    expect(dotR).toBe(3);
    expect(haloR).toBe(4);

    const distance = Math.hypot(20 - cx, 5 - cy);
    const dotCoverage = Math.max(0, Math.min(1, dotR + 0.5 - distance));
    const haloCoverage = Math.max(0, Math.min(1, haloR + 0.5 - distance));
    expect(dotCoverage).toBe(0.5);
    expect(haloCoverage).toBe(1);

    const afterHalo = expectedAfterBlend(
      { b: 0, g: 0, r: 0, a: 0 },
      UNREAD_DOT_RING_RGB,
      haloCoverage,
    );
    const expected = expectedAfterBlend(afterHalo, UNREAD_DOT_RGB, dotCoverage);
    // Pure-dot replace would be alpha 128; blended boundary stays opaque with both coverages.
    expect(expected.a).toBe(255);

    const [b, g, r, a] = pixelAt(bitmap, width, 20, 5);
    expect(b).toBe(expected.b);
    expect(g).toBe(expected.g);
    expect(r).toBe(expected.r);
    expect(a).toBe(expected.a);
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
