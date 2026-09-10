// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  bindNomadMicronMedia,
  bindNomadMicronPartials,
  buildNomadLinkRequest,
  collectNomadFormFieldValues,
  formatNomadRequestDataForUrlBar,
  isNomadFilePath,
  isNomadMediaPath,
  isNomadMicronPage,
  loadNomadMicronPartial,
  mountNomadMicronHtml,
  NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY,
  nomadPageRequestDataEquals,
  normalizeNomadPageRequestData,
  parseNomadLinkFieldsSpec,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
  resolveNomadMediaFetchTarget,
  serializeNomadPageRequestDataKey,
  splitNomadLinkDestination,
} from './micronParser';

const rendererDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const stylesCss = readFileSync(join(rendererDir, 'styles.css'), 'utf8');
const nomadFontWoff2Path = join(rendererDir, 'assets/fonts/MeshClientNomadMono.woff2');

describe('nomad-micron-page whitespace CSS contract', () => {
  it('preserves spaces in open-width and wraps with pre-wrap in fit-width', () => {
    expect(stylesCss).toMatch(/\.nomad-micron-page\s*\{[^}]*white-space:\s*pre;/s);
    expect(stylesCss).toMatch(/\.nomad-micron-page--fit-width\s*\{[^}]*white-space:\s*pre-wrap;/s);
  });
});

describe('nomad-micron-page bundled Nerd Mono font contract', () => {
  it('declares @font-face MeshClientNomadMono pointing at the bundled woff2', () => {
    expect(stylesCss).toMatch(
      /@font-face\s*\{[^}]*font-family:\s*MeshClientNomadMono;[^}]*url\(['"]\.\/assets\/fonts\/MeshClientNomadMono\.woff2['"]\)/s,
    );
    expect(existsSync(nomadFontWoff2Path)).toBe(true);
    // Non-empty woff2 (subset includes Latin + Nerd PUA).
    expect(readFileSync(nomadFontWoff2Path).byteLength).toBeGreaterThan(10_000);
  });

  it('lists MeshClientNomadMono first on .nomad-micron-page font-family', () => {
    expect(stylesCss).toMatch(
      /\.nomad-micron-page\s*\{[^}]*font-family:\s*MeshClientNomadMono\s*,/s,
    );
  });

  it('keeps FA/Nerd PUA glyphs in mounted Micron link labels', () => {
    const userIcon = '\uf007';
    const markup = `\`FT86efac\`[${userIcon} About me\`:/page/about.mu]\`f`;
    const html = renderNomadMicronPage(markup);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    expect(container.textContent).toContain(userIcon);
    expect(container.textContent).toContain('About me');
    expect(container.querySelector('[data-action="openNode"]')).not.toBeNull();
  });
});

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
    const plainText = container.textContent;

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

  it('preserves RMAP-style box padding spaces before Unicode borders', () => {
    // Padding spaces before trailing │ must survive parse/mount (CSS white-space: pre* keeps them visible).
    const markup = [
      '    │  This is the NomadNet page of the RMAP Project, a web interface      │',
      '    │  `F8f0•`f Visualize LoRa RNode Connection Info,                        │ │',
    ].join('\n');
    const html = renderNomadMicronPage(markup);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const plainText = container.textContent;

    expect(plainText).toMatch(/web interface {2,}│/);
    expect(plainText).toMatch(/Connection Info, {2,}│ │/);
    expect(plainText).not.toMatch(/web interface│/);
    expect(plainText).not.toMatch(/Connection Info,││/);
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

  it('keeps tag-like page text inert instead of building an element', () => {
    const html = renderNomadMicronPage('before <img src=x onerror="alert(1)"> after');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);

    expect(container.querySelector('img')).toBeNull();
    // The handler survives only as literal text, which is what the page author typed.
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('after');
  });

  it('renders literal angle brackets and ampersands as text', () => {
    const html = renderNomadMicronPage('a < b & c > d');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    expect(container.textContent).toContain('a < b & c > d');
  });

  it('keeps tag-like link labels inert', () => {
    const html = renderNomadMicronPage('`[<img src=x onerror="alert(1)">label`:/page/index.mu]`');
    expect(html).not.toContain('<img');

    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const link = container.querySelector('[data-action="openNode"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('label');
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

describe('NomadNet 1.4.1 micron images and collapsibles', () => {
  it('hides NomadNet comment lines', () => {
    const html = renderNomadMicronPage('# secret\n`!Hi:`!');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    expect(container.textContent).not.toContain('secret');
    expect(container.textContent).toContain('Hi');
  });

  it('marks truecolor tips that match page background for hiding', () => {
    const markup =
      '#!bg=020617\n`FT020617Site looks odd? `[Get the mesh client`:/page/mesh-client.mu]`\n`FT86efacVisible`f';
    const html = renderNomadMicronPage(markup);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const hidden = container.querySelectorAll('.nomad-micron-fg-matches-bg');
    expect(hidden.length).toBeGreaterThan(0);
    expect([...hidden].every((el) => el.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect([...hidden].some((el) => (el.textContent || '').includes('Site looks odd'))).toBe(true);
    expect(container.textContent).toContain('Visible');
  });

  it('renders image placeholders with media data attributes', () => {
    const markup = '`(The RNS logo`w=n`a=c`:/media/demo.webp)';
    const html = renderNomadMicronPage(markup);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const img = container.querySelector<HTMLImageElement>('.nomad-micron-media');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('data-nomad-media-url')).toBe(':/media/demo.webp');
    expect(img?.getAttribute('data-nomad-media-alt')).toBe('The RNS logo');
    expect(img?.getAttribute('data-w')).toBe('n');
    expect(img?.getAttribute('data-a')).toBe('c');
    expect(img?.alt).toBe('The RNS logo');
    const figure = container.querySelector<HTMLElement>('.nomad-micron-media-figure');
    expect(figure?.style.textAlign).toBe('center');
    expect(figure?.style.width).toBe('100%');
    // w=n → no forced ch/% width
    expect(img?.style.width).toBe('');
  });

  it('applies NomadNet column width and center align', () => {
    const html = renderNomadMicronPage('`(x`w=30`a=c`:/media/x.webp)');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const img = container.querySelector<HTMLImageElement>('.nomad-micron-media');
    const figure = container.querySelector<HTMLElement>('.nomad-micron-media-figure');
    expect(img?.style.width).toBe('30ch');
    expect(img?.style.height).toBe('auto');
    expect(figure?.style.textAlign).toBe('center');
  });

  it('applies percent width specs', () => {
    const html = renderNomadMicronPage('`(x`w=30%`:/media/x.webp)');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const img = container.querySelector<HTMLImageElement>('.nomad-micron-media');
    expect(img?.style.width).toBe('30%');
  });

  it('defaults omitted width to full layout width and omitted align to center', () => {
    const html = renderNomadMicronPage('`(x`:/media/x.webp)');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const img = container.querySelector<HTMLImageElement>('.nomad-micron-media');
    const figure = container.querySelector<HTMLElement>('.nomad-micron-media-figure');
    expect(img?.style.width).toBe('100%');
    expect(figure?.style.textAlign).toBe('center');
  });

  it('does not inherit page left align when image a= is omitted', () => {
    const html = renderNomadMicronPage('`l\n`(x`w=20`:/media/x.webp)');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const figure = container.querySelector<HTMLElement>('.nomad-micron-media-figure');
    expect(figure?.style.textAlign).toBe('center');
  });

  it('applies both width and height with object-fit contain', () => {
    const html = renderNomadMicronPage('`(x`w=40`h=10`:/media/x.webp)');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const img = container.querySelector<HTMLImageElement>('.nomad-micron-media');
    expect(img?.style.width).toBe('40ch');
    expect(img?.style.height).toBe('10lh');
    expect(img?.style.objectFit).toBe('contain');
  });

  it('keeps full-width default for height-only images and centers independently of page align', () => {
    const html = renderNomadMicronPage('`l\n`(x`h=12`:/media/x.webp)');
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const img = container.querySelector<HTMLImageElement>('.nomad-micron-media');
    const figure = container.querySelector<HTMLElement>('.nomad-micron-media-figure');
    expect(img?.style.width).toBe('100%');
    expect(img?.style.height).toBe('12lh');
    expect(img?.style.maxHeight).toBe('12lh');
    expect(img?.style.objectFit).toBe('contain');
    expect(figure?.style.textAlign).toBe('center');
  });

  it('renders open and collapsed collapsible headings as details/summary', () => {
    const markup = [
      '`+>Open by default',
      'Visible body',
      '`->Starts collapsed',
      'Hidden until expanded',
      '>Normal heading',
      'After fold',
    ].join('\n');
    const html = renderNomadMicronPage(markup);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const details = Array.from(
      container.querySelectorAll<HTMLDetailsElement>('details.nomad-micron-collapsible'),
    );
    expect(details).toHaveLength(2);
    expect(details[0].open).toBe(true);
    expect(details[0].querySelector('summary')?.textContent).toContain('Open by default');
    expect(details[0].textContent).toContain('Visible body');
    expect(details[1].open).toBe(false);
    expect(details[1].querySelector('summary')?.textContent).toContain('Starts collapsed');
    expect(container.textContent).toContain('After fold');
  });

  it('resolveNomadMediaFetchTarget extracts /media path for the request', () => {
    expect(resolveNomadMediaFetchTarget(':/media/demo.webp', 'abc', '/page/index.mu')).toEqual({
      hash: 'abc',
      mediaPath: '/media/demo.webp',
    });
    expect(
      resolveNomadMediaFetchTarget('abcdefabcdefabcdefabcdefabcdefab:/media/x.webp', 'fallback'),
    ).toEqual({
      hash: 'abcdefabcdefabcdefabcdefabcdefab',
      mediaPath: '/media/x.webp',
    });
    expect(resolveNomadMediaFetchTarget('/media/bare.webp', 'abc')).toEqual({
      hash: 'abc',
      mediaPath: '/media/bare.webp',
    });
    expect(resolveNomadMediaFetchTarget(':/page/index.mu', 'abc')).toBeNull();
  });

  it('isNomadMediaPath detects media routes', () => {
    expect(isNomadMediaPath('/media/demo.webp')).toBe(true);
    expect(isNomadMediaPath('media/demo.webp')).toBe(true);
    expect(isNomadMediaPath('/file/demo.webp')).toBe(false);
  });

  it('limits concurrent /media fetches to the configured pool size', async () => {
    const lines = Array.from(
      { length: NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY + 3 },
      (_, i) => `\`(Img ${i}\`:/media/i${i}.webp)`,
    );
    const container = document.createElement('div');
    mountNomadMicronHtml(container, renderNomadMicronPage(lines.join('\n')));

    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMedia = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return {
        ok: true,
        content_base64: 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
        file_name: 'i.webp',
      };
    });

    await bindNomadMicronMedia(container, {
      selectedHash: 'a'.repeat(32),
      fetchMedia,
      concurrency: NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY,
    });

    expect(fetchMedia).toHaveBeenCalledTimes(NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY + 3);
    expect(maxInFlight).toBeLessThanOrEqual(NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('skips DOM updates after AbortSignal aborts', async () => {
    const container = document.createElement('div');
    mountNomadMicronHtml(container, renderNomadMicronPage('`(Banner`:/media/demo.webp)'));
    const ac = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMedia = vi.fn(async () => {
      await gate;
      return {
        ok: true,
        content_base64: 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
        file_name: 'demo.webp',
      };
    });
    const pending = bindNomadMicronMedia(container, {
      selectedHash: 'a'.repeat(32),
      fetchMedia,
      signal: ac.signal,
    });
    ac.abort();
    release();
    await pending;
    const img = container.querySelector<HTMLImageElement>('.nomad-micron-media');
    expect(img?.getAttribute('src') ?? '').not.toMatch(/^data:image\/webp/);
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

  it('escapes delimiter characters so requestData maps do not collide', () => {
    const withPipeInValue = serializeNomadPageRequestDataKey({ var_a: '1|var_b=2' });
    const twoEntries = serializeNomadPageRequestDataKey({ var_a: '1', var_b: '2' });
    expect(withPipeInValue).not.toBe(twoEntries);
    expect(withPipeInValue).toBe(`var_a=${encodeURIComponent('1|var_b=2')}`);
    expect(twoEntries).toBe('var_a=1|var_b=2');
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
