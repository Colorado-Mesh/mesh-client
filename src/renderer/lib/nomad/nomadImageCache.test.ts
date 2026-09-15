import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearNomadImageCache,
  getNomadImageCache,
  MAX_NOMAD_IMAGE_CACHE_BASE64_CHARS,
  nomadImageCacheSizeForTests,
  setNomadImageCache,
} from './nomadImageCache';

describe('nomadImageCache', () => {
  beforeEach(() => {
    clearNomadImageCache();
  });

  it('stores and retrieves cached media by hash and path', () => {
    setNomadImageCache(
      { hash: 'abc1234567890abcdef1234567890ab', mediaPath: '/media/demo.webp' },
      { content_base64: 'aGVsbG8=', file_name: 'demo.webp' },
    );
    const hit = getNomadImageCache({
      hash: 'abc1234567890abcdef1234567890ab',
      mediaPath: '/media/demo.webp',
    });
    expect(hit?.content_base64).toBe('aGVsbG8=');
    expect(hit?.file_name).toBe('demo.webp');
  });

  it('normalizes media paths without a leading slash', () => {
    setNomadImageCache(
      { hash: 'abc1234567890abcdef1234567890ab', mediaPath: 'media/demo.webp' },
      { content_base64: 'aGVsbG8=' },
    );
    expect(
      getNomadImageCache({
        hash: 'abc1234567890abcdef1234567890ab',
        mediaPath: '/media/demo.webp',
      })?.content_base64,
    ).toBe('aGVsbG8=');
  });

  it('skips entries larger than the base64 cap', () => {
    setNomadImageCache(
      { hash: 'abc1234567890abcdef1234567890ab', mediaPath: '/media/huge.webp' },
      { content_base64: 'x'.repeat(MAX_NOMAD_IMAGE_CACHE_BASE64_CHARS + 1) },
    );
    expect(nomadImageCacheSizeForTests()).toBe(0);
    expect(
      getNomadImageCache({
        hash: 'abc1234567890abcdef1234567890ab',
        mediaPath: '/media/huge.webp',
      }),
    ).toBeUndefined();
  });

  it('evicts oldest entries when over capacity', () => {
    for (let i = 0; i < 129; i++) {
      const hash = `${i}`.padStart(32, 'a');
      setNomadImageCache({ hash, mediaPath: `/media/${i}.webp` }, { content_base64: `img-${i}` });
    }
    expect(nomadImageCacheSizeForTests()).toBe(128);
    expect(
      getNomadImageCache({ hash: `0`.padStart(32, 'a'), mediaPath: '/media/0.webp' }),
    ).toBeUndefined();
    expect(
      getNomadImageCache({ hash: `128`.padStart(32, 'a'), mediaPath: '/media/128.webp' })
        ?.content_base64,
    ).toBe('img-128');
  });
});
