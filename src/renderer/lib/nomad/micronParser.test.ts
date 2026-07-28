// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  bindNomadMicronPartials,
  buildNomadLinkRequest,
  collectNomadFormFieldValues,
  formatNomadRequestDataForUrlBar,
  isNomadFilePath,
  isNomadMicronPage,
  loadNomadMicronPartial,
  mountNomadMicronHtml,
  nomadPageRequestDataEquals,
  normalizeNomadPageRequestData,
  parseNomadLinkFieldsSpec,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
  serializeNomadPageRequestDataKey,
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

  it('renders Micron tables as HTML table elements', () => {
    const markup = ['`t', 'Name | Status', '--- | ---', 'Alpha | Up', 'Beta | Down', '`t'].join(
      '\n',
    );
    const html = renderNomadMicronPage(markup);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Down');
  });

  it('emits header anchors for Micron section headings', () => {
    const html = renderNomadMicronPage('> Section Title');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const anchor = container.querySelector('.micron-header-anchor');
    expect(anchor).not.toBeNull();
    expect(anchor?.id).toBe('section-title');
  });

  it('emits Mu-partial placeholders for embedded partials', () => {
    const hash = 'a'.repeat(32);
    const html = renderNomadMicronPage(`\`{${hash}:/page/partial.mu}`);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const partial = container.querySelector('.Mu-partial');
    expect(partial).not.toBeNull();
    expect(partial?.getAttribute('data-partial-destination')).toBe(`${hash}:/page/partial.mu`);
    expect(partial?.textContent).toContain('⧖');
  });
});

describe('loadNomadMicronPartial', () => {
  it('fetches, renders Micron markup, and includes form field request data', async () => {
    const hash = 'b'.repeat(32);
    const formContainer = document.createElement('div');
    formContainer.innerHTML = '<input name="user_name" value="joey">';
    const fetchPage = vi.fn().mockResolvedValue({
      ok: true,
      content: '`!Partial body:`!',
    });

    const result = await loadNomadMicronPartial({
      destination: `${hash}:/page/hello_partial.mu`,
      fields: ['pid=32', 'user_name', 'mode=live'],
      signal: null,
      defaultPagePath: '/page/index.mu',
      selectedHash: 'c'.repeat(32),
      formContainer,
      fetchPage,
    });

    expect(fetchPage).toHaveBeenCalledWith(
      hash,
      '/page/hello_partial.mu',
      expect.objectContaining({
        field_user_name: 'joey',
        var_mode: 'live',
      }),
    );
    expect(result.markup).toContain('Partial body');
    expect(result.markup.toLowerCase()).not.toContain('<script');
  });

  it('throws when the page fetch fails', async () => {
    await expect(
      loadNomadMicronPartial({
        destination: ':/page/missing.mu',
        fields: [],
        signal: null,
        defaultPagePath: '/page/index.mu',
        selectedHash: 'd'.repeat(32),
        formContainer: null,
        fetchPage: vi.fn().mockResolvedValue({ ok: false, error: 'not_found' }),
      }),
    ).rejects.toThrow('not_found');
  });
});

describe('bindNomadMicronPartials', () => {
  it('loads partial content and cleans up refresh timers', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    mountNomadMicronHtml(container, renderNomadMicronPage('`{:/page/tick.mu`1}'));
    const fetchPage = vi.fn().mockResolvedValue({
      ok: true,
      content: 'TICK_CONTENT_UNIQUE',
    });
    const cleanup = bindNomadMicronPartials(container, async (info) =>
      loadNomadMicronPartial({
        destination: info.destination,
        fields: info.fields,
        signal: info.signal,
        defaultPagePath: '/page/index.mu',
        selectedHash: 'e'.repeat(32),
        formContainer: container,
        fetchPage,
      }),
    );

    await vi.waitFor(() => {
      expect(container.textContent).toContain('TICK_CONTENT_UNIQUE');
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);

    cleanup();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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

describe('nomad page requestData helpers', () => {
  it('serializes request data with sorted keys for stable cache identity', () => {
    expect(serializeNomadPageRequestDataKey(undefined)).toBe('');
    expect(serializeNomadPageRequestDataKey({})).toBe('');
    expect(serializeNomadPageRequestDataKey({ var_b: '2', var_a: '1', field_q: 'x' })).toBe(
      'field_q=x|var_a=1|var_b=2',
    );
    expect(serializeNomadPageRequestDataKey({ var_a: '1', var_b: '2' })).toBe(
      serializeNomadPageRequestDataKey({ var_b: '2', var_a: '1' }),
    );
  });

  it('formats only var_* keys for the URL bar', () => {
    expect(formatNomadRequestDataForUrlBar(undefined)).toBe('');
    expect(
      formatNomadRequestDataForUrlBar({
        var_thread_id: 'abc',
        field_q: 'ignored',
        var_mode: 'live',
      }),
    ).toBe('mode=live|thread_id=abc');
  });

  it('normalizes empty maps and compares by serialized key', () => {
    expect(normalizeNomadPageRequestData({})).toBeUndefined();
    expect(normalizeNomadPageRequestData({ var_id: '1' })).toEqual({ var_id: '1' });
    expect(nomadPageRequestDataEquals({ var_a: '1' }, { var_a: '1' })).toBe(true);
    expect(nomadPageRequestDataEquals({ var_a: '1' }, { var_a: '2' })).toBe(false);
    expect(nomadPageRequestDataEquals(undefined, {})).toBe(true);
  });
});
