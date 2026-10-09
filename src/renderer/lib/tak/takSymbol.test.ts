import { describe, expect, it } from 'vitest';

import {
  parseTakSymbol,
  TAK_AFFILIATION_COLORS,
  takAffiliation,
  takSymbolKey,
  takSymbolSvg,
} from './takSymbol';

describe('takAffiliation', () => {
  it.each([
    ['a-f-G-U-C', 'friend'],
    ['a-a-G', 'friend'],
    ['a-h-G', 'hostile'],
    ['a-s-A', 'hostile'],
    ['a-n-G', 'neutral'],
    ['a-u-G', 'unknown'],
    ['a-p-G', 'unknown'],
    ['b-m-p-s-m', 'point'],
  ])('%s is %s', (type, expected) => {
    expect(takAffiliation(type)).toBe(expected);
  });
});

describe('parseTakSymbol', () => {
  it.each([
    ['a-f-G-U-C', 'ground', 'none'],
    ['a-f-G-U-C-I', 'ground', 'infantry'],
    ['a-f-G-U-C-I-Z', 'ground', 'infantry'],
    ['a-f-G-U-C-R', 'ground', 'recon'],
    ['a-f-G-U-C-A', 'ground', 'armor'],
    ['a-f-G-U-S-M', 'ground', 'medical'],
    ['a-f-G-E-V', 'ground', 'vehicle'],
    ['a-f-G-E-S', 'ground', 'sensor'],
    ['a-f-G-I', 'ground', 'installation'],
    ['a-h-A', 'air', 'none'],
    ['a-n-S', 'sea', 'none'],
    ['a-u-U', 'subsurface', 'none'],
    ['a-f-P', 'space', 'none'],
    ['a-f-F', 'other', 'none'],
    ['a-f', 'other', 'none'],
  ])('%s → %s / %s', (type, dimension, glyph) => {
    const s = parseTakSymbol(type);
    expect(s.dimension).toBe(dimension);
    expect(s.glyph).toBe(glyph);
  });

  it('does not match a glyph on a partial segment', () => {
    expect(parseTakSymbol('a-f-G-IX').glyph).toBe('none');
  });

  it('treats non-atoms as points', () => {
    expect(parseTakSymbol('b-m-p-s-m')).toEqual({
      affiliation: 'point',
      dimension: 'other',
      glyph: 'none',
    });
  });
});

describe('takSymbolSvg', () => {
  it('colors the frame by affiliation and hides it from assistive tech', () => {
    for (const type of ['a-f-G-U-C', 'a-h-G', 'a-n-A', 'a-u-U', 'b-m-p-s-m']) {
      const s = parseTakSymbol(type);
      const svg = takSymbolSvg(s);
      expect(svg).toContain(TAK_AFFILIATION_COLORS[s.affiliation]);
      expect(svg).toContain('aria-hidden="true"');
    }
  });

  it('draws different frames per dimension and different glyphs per function', () => {
    const ground = takSymbolSvg(parseTakSymbol('a-f-G-U-C'));
    expect(takSymbolSvg(parseTakSymbol('a-f-A'))).not.toBe(ground);
    expect(takSymbolSvg(parseTakSymbol('a-f-G-U-C-I'))).not.toBe(ground);
    expect(takSymbolSvg(parseTakSymbol('a-f-G-U-S-M'))).not.toBe(
      takSymbolSvg(parseTakSymbol('a-f-G-U-C-I')),
    );
  });

  it('keys equal symbols together', () => {
    expect(takSymbolKey(parseTakSymbol('a-f-G-U-C-I'))).toBe(
      takSymbolKey(parseTakSymbol('a-f-G-U-C-I-Z')),
    );
  });
});
