import { describe, expect, it } from 'vitest';

import { lxmface, normalizeLxmfaceSeed } from './lxmface';

describe('normalizeLxmfaceSeed', () => {
  it('accepts lowercase 32-hex', () => {
    expect(normalizeLxmfaceSeed('a7b3c9d1e5f20681943ab2de77fc8e01')).toBe(
      'a7b3c9d1e5f20681943ab2de77fc8e01',
    );
  });

  it('lowercases and trims', () => {
    expect(normalizeLxmfaceSeed('  A7B3C9D1E5F20681943AB2DE77FC8E01  ')).toBe(
      'a7b3c9d1e5f20681943ab2de77fc8e01',
    );
  });

  it('rejects short or non-hex', () => {
    expect(normalizeLxmfaceSeed('abc')).toBeNull();
    expect(normalizeLxmfaceSeed('gggggggggggggggggggggggggggggggg')).toBeNull();
    expect(normalizeLxmfaceSeed(null)).toBeNull();
  });
});

describe('lxmface', () => {
  const seed = 'a7b3c9d1e5f20681943ab2de77fc8e01';

  it('returns a clipped SVG of the requested size', () => {
    const svg = lxmface(seed, 32);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('width="32"');
    expect(svg).toContain('height="32"');
    expect(svg).toContain(`clipPath id="lxmface-clip-${seed}"`);
    expect(svg).toContain(`clip-path="url(#lxmface-clip-${seed})"`);
    expect(svg).toContain('<rect ');
  });

  it('is deterministic for the same seed', () => {
    expect(lxmface(seed, 16)).toBe(lxmface(seed, 16));
  });

  it('differs across seeds', () => {
    const other = 'ffffffffffffffffffffffffffffffff';
    expect(lxmface(seed, 16)).not.toBe(lxmface(other, 16));
  });

  it('uses distinct clip ids per seed (no shared id collision)', () => {
    const other = 'ffffffffffffffffffffffffffffffff';
    expect(lxmface(seed, 16)).toContain(`lxmface-clip-${seed}`);
    expect(lxmface(other, 16)).toContain(`lxmface-clip-${other}`);
    expect(lxmface(seed, 16)).not.toContain(`lxmface-clip-${other}`);
  });
});
