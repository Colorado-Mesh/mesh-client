import { describe, expect, it } from 'vitest';

import { isLikelyDirectImageUrl } from './chatDirectImageUrl';

describe('isLikelyDirectImageUrl', () => {
  it('detects common raster extensions ignoring query', () => {
    expect(isLikelyDirectImageUrl('https://cdn.example.com/a/photo.JPG?w=800')).toBe(true);
    expect(isLikelyDirectImageUrl('https://cdn.example.com/a/photo.png')).toBe(true);
    expect(isLikelyDirectImageUrl('https://cdn.example.com/a/photo.webp')).toBe(true);
    expect(isLikelyDirectImageUrl('https://cdn.example.com/a/photo.gif')).toBe(true);
  });

  it('rejects non-image paths and invalid URLs', () => {
    expect(isLikelyDirectImageUrl('https://example.com/page')).toBe(false);
    expect(isLikelyDirectImageUrl('https://example.com/photo.svg')).toBe(false);
    expect(isLikelyDirectImageUrl('ftp://cdn.example.com/a/photo.png')).toBe(false);
    expect(isLikelyDirectImageUrl('not a url')).toBe(false);
  });
});
