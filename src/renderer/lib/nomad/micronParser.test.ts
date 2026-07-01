// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  isNomadFilePath,
  isNomadMicronPage,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
} from './micronParser';

describe('renderNomadMicronPage', () => {
  it('renders headings, colors, separators, and links from Micron markup', () => {
    const markup = [
      '`!Hello Nomad:`!',
      '`B333`colored text`F000`',
      '`---`',
      '`[link text`:/page/translation.mu`*]`',
      '`_`[Libretranslate`https://libretranslate.com/]`_`',
    ].join('\n');

    const html = renderNomadMicronPage(markup);
    const plainText = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

    expect(plainText).toContain('Hello Nomad');
    expect(plainText).toContain('olored text');
    expect(html).toContain('font-weight: bold');
    expect(plainText).toContain('--');
    expect(html).toContain('data-action="openNode"');
    expect(plainText).toContain('link text');
    expect(plainText).toContain('Libretranslate');
    expect(html).toContain('https://libretranslate.com/');
  });
});

describe('parseNomadNetworkLinkUrl', () => {
  it('parses relative page paths', () => {
    expect(parseNomadNetworkLinkUrl(':/page/translation.mu')).toEqual({
      destination_hash: null,
      path: '/page/translation.mu',
    });
  });

  it('parses relative file paths', () => {
    expect(parseNomadNetworkLinkUrl(':/file/readme.txt')).toEqual({
      destination_hash: null,
      path: '/file/readme.txt',
    });
  });

  it('parses absolute destination file paths', () => {
    const hash = 'a'.repeat(32);
    expect(parseNomadNetworkLinkUrl(`${hash}:/file/docs/guide.pdf`)).toEqual({
      destination_hash: hash,
      path: '/file/docs/guide.pdf',
    });
  });

  it('parses absolute destination paths', () => {
    const hash = 'a'.repeat(32);
    expect(parseNomadNetworkLinkUrl(`${hash}:/page/foo.mu`)).toEqual({
      destination_hash: hash,
      path: '/page/foo.mu',
    });
  });

  it('returns null for external http urls', () => {
    expect(parseNomadNetworkLinkUrl('https://libretranslate.com/')).toBeNull();
  });
});

describe('isNomadFilePath', () => {
  it('detects /file/ paths', () => {
    expect(isNomadFilePath('/file/readme.txt')).toBe(true);
    expect(isNomadFilePath('file/readme.txt')).toBe(true);
    expect(isNomadFilePath('/page/index.mu')).toBe(false);
  });
});

describe('isNomadMicronPage', () => {
  it('detects micron content type and .mu paths', () => {
    expect(isNomadMicronPage('micron', '/page/index.mu')).toBe(true);
    expect(isNomadMicronPage(undefined, '/page/index.mu')).toBe(true);
    expect(isNomadMicronPage('text/plain', '/file/readme.txt')).toBe(false);
  });
});
