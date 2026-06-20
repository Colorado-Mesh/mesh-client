import { describe, expect, it } from 'vitest';

import { meshcoreGiphyMediaUrl, meshcoreGiphyPageUrl, parseMeshcoreGifId } from './meshcoreGifWire';

describe('parseMeshcoreGifId', () => {
  it('parses MeshCore Open short wire g:GIFID', () => {
    expect(parseMeshcoreGifId('g:a5viI92PAF89q')).toBe('a5viI92PAF89q');
  });

  it('parses Giphy media URL', () => {
    expect(parseMeshcoreGifId('https://media.giphy.com/media/a5viI92PAF89q/giphy.gif')).toBe(
      'a5viI92PAF89q',
    );
  });

  it('parses Giphy page URL', () => {
    expect(parseMeshcoreGifId('https://giphy.com/gifs/funny-cat-a5viI92PAF89q')).toBe(
      'a5viI92PAF89q',
    );
  });

  it('returns null for plain chat text', () => {
    expect(parseMeshcoreGifId('hello mesh')).toBeNull();
    expect(parseMeshcoreGifId('g:')).toBeNull();
  });

  it('rejects hostname bypass via substring prefix checks', () => {
    expect(parseMeshcoreGifId('https://evil.com/media/giphy.com/media/x/giphy.gif')).toBeNull();
    expect(parseMeshcoreGifId('https://media.giphy.com.evil.com/media/x/giphy.gif')).toBeNull();
  });
});

describe('meshcoreGiphyMediaUrl', () => {
  it('builds CDN URL for gif id', () => {
    expect(meshcoreGiphyMediaUrl('a5viI92PAF89q')).toBe(
      'https://media.giphy.com/media/a5viI92PAF89q/giphy.gif',
    );
    expect(meshcoreGiphyPageUrl('a5viI92PAF89q')).toBe('https://giphy.com/gifs/a5viI92PAF89q');
  });
});
