import { describe, expect, it } from 'vitest';

import { findReticulumChatLinks } from './reticulumLinkText';

const HASH = '3b5bc6888356193f1ac1bfb716c1beef';

describe('findReticulumChatLinks', () => {
  it('detects a plain nomad page address', () => {
    const text = `${HASH}:/page/index.mu`;
    expect(findReticulumChatLinks(text)).toEqual([
      { kind: 'nomadPage', start: 0, end: text.length, url: text },
    ]);
  });

  it('detects a scheme-prefixed nomad page address', () => {
    const text = `nomadnetwork://${HASH}:/page/index.mu`;
    const links = findReticulumChatLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe('nomadPage');
    expect(links[0].url).toBe(text);
  });

  it('treats a scheme-prefixed hash without a path as a page link', () => {
    const links = findReticulumChatLinks(`nomadnetwork://${HASH}`);
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe('nomadPage');
  });

  it('detects a bare hash as a DM link', () => {
    const links = findReticulumChatLinks(HASH);
    expect(links).toEqual([
      { kind: 'dm', start: 0, end: HASH.length, url: HASH, destinationHash: HASH },
    ]);
  });

  it.each(['lxmf://', 'lxmf@', 'lxmf.delivery@'])('detects %s addresses as DM links', (prefix) => {
    const text = `${prefix}${HASH}`;
    const links = findReticulumChatLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'dm', destinationHash: HASH, url: text });
  });

  it('normalizes uppercase hashes', () => {
    const links = findReticulumChatLinks(HASH.toUpperCase());
    expect(links[0]).toMatchObject({ kind: 'dm', destinationHash: HASH });
  });

  it('strips trailing punctuation', () => {
    const text = `see ${HASH}:/page/index.mu.`;
    const links = findReticulumChatLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe(`${HASH}:/page/index.mu`);
    expect(text.slice(links[0].start, links[0].end)).toBe(links[0].url);
  });

  it('strips a trailing paren', () => {
    const links = findReticulumChatLinks(`(${HASH})`);
    expect(links).toEqual([
      { kind: 'dm', start: 1, end: 1 + HASH.length, url: HASH, destinationHash: HASH },
    ]);
  });

  it('finds an address inside a sentence', () => {
    const text = `check ${HASH}:/page/about.mu for details`;
    const links = findReticulumChatLinks(text);
    expect(links).toHaveLength(1);
    expect(links[0].start).toBe(6);
    expect(text.slice(links[0].start, links[0].end)).toBe(`${HASH}:/page/about.mu`);
  });

  it('finds multiple addresses', () => {
    const other = 'a'.repeat(32);
    const links = findReticulumChatLinks(`${HASH}:/page/index.mu and ${other}`);
    expect(links.map((l) => l.kind)).toEqual(['nomadPage', 'dm']);
  });

  it('ignores http urls', () => {
    expect(findReticulumChatLinks('https://example.com/page/index.mu')).toEqual([]);
  });

  it('ignores hashes of the wrong length', () => {
    expect(findReticulumChatLinks('a'.repeat(31))).toEqual([]);
    expect(findReticulumChatLinks('a'.repeat(33))).toEqual([]);
  });

  it('ignores a hash embedded in a longer hex blob', () => {
    expect(findReticulumChatLinks(`deadbeef${HASH}`)).toEqual([]);
  });

  it('ignores plain text', () => {
    expect(findReticulumChatLinks('hello world')).toEqual([]);
  });
});
