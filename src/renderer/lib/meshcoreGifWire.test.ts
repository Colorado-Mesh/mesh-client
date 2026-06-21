import { describe, expect, it } from 'vitest';

import {
  formatMeshcoreGifWire,
  meshcoreGiphyMediaUrl,
  meshcoreGiphyPageUrl,
  normalizeMeshcoreGifOutboundWire,
  parseMeshcoreGifId,
} from './meshcoreGifWire';

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

describe('formatMeshcoreGifWire', () => {
  it('encodes gif id as g: wire', () => {
    expect(formatMeshcoreGifWire('a5viI92PAF89q')).toBe('g:a5viI92PAF89q');
  });

  it('throws for invalid gif id', () => {
    expect(() => formatMeshcoreGifWire('bad id!')).toThrow('Invalid Giphy id');
  });
});

describe('normalizeMeshcoreGifOutboundWire', () => {
  it('normalizes media URL to compact wire', () => {
    expect(
      normalizeMeshcoreGifOutboundWire('https://media.giphy.com/media/a5viI92PAF89q/giphy.gif'),
    ).toBe('g:a5viI92PAF89q');
  });

  it('returns null for plain chat text', () => {
    expect(normalizeMeshcoreGifOutboundWire('hello')).toBeNull();
  });
});
