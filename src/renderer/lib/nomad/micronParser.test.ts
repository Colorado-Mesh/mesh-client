// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  buildNomadLinkRequest,
  collectNomadFormFieldValues,
  isNomadFilePath,
  isNomadMicronPage,
  mountNomadMicronHtml,
  parseNomadLinkFieldsSpec,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
  splitNomadLinkDestination,
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
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const plainText = container.textContent ?? '';

    expect(plainText).toContain('Hello Nomad');
    expect(plainText).toContain('olored text');
    expect(html).toContain('font-weight: bold');
    expect(plainText).toContain('--');
    expect(html).toContain('data-action="openNode"');
    expect(plainText).toContain('link text');
    expect(plainText).toContain('Libretranslate');
    expect(html).toContain('https://libretranslate.com/');
    expect(html.toLowerCase()).not.toContain('<script');
  });
});

describe('renderNomadMicronPage XSS', () => {
  it('strips script markup from malicious micron input', () => {
    const html = renderNomadMicronPage('`<script>alert(1)</script>Hello`');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('Hello');
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

describe('parseNomadLinkFieldsSpec', () => {
  it('parses named fields, submit-all, and request vars', () => {
    expect(parseNomadLinkFieldsSpec('q|mode=search')).toEqual({
      fieldNames: ['q'],
      requestVars: { mode: 'search' },
    });
    expect(parseNomadLinkFieldsSpec('*')).toEqual({
      fieldNames: '*',
      requestVars: {},
    });
  });
});

describe('collectNomadFormFieldValues', () => {
  it('collects text, checkbox, and radio values with field_ prefix', () => {
    const container = document.createElement('div');
    container.innerHTML = [
      '<input name="q" value="hello">',
      '<input type="checkbox" name="agree" value="yes" checked>',
      '<input type="radio" name="pick" value="a">',
      '<input type="radio" name="pick" value="b" checked>',
    ].join('');
    const values = collectNomadFormFieldValues(container, {
      fieldNames: '*',
      requestVars: { mode: 'search' },
    });
    expect(values).toEqual({
      var_mode: 'search',
      field_q: 'hello',
      field_agree: 'yes',
      field_pick: 'b',
    });
  });
});

describe('buildNomadLinkRequest', () => {
  it('strips embedded backtick vars and collects named fields', () => {
    const container = document.createElement('div');
    container.innerHTML = '<input name="q" value="mesh">';
    const result = buildNomadLinkRequest(':/page/search.mu`mode=results', 'q', container);
    expect(result.destination).toBe(':/page/search.mu');
    expect(result.requestData).toEqual({
      var_mode: 'results',
      field_q: 'mesh',
    });
  });

  it('splits destination with splitNomadLinkDestination', () => {
    expect(splitNomadLinkDestination(':/page/foo.mu`a=1|b=2')).toEqual({
      baseDestination: ':/page/foo.mu',
      embeddedFieldsSpec: 'a=1|b=2',
    });
  });
});
