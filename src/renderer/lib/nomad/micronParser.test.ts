// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import DOMPurify from 'dompurify';
import { describe, expect, it, vi } from 'vitest';

import { renderRrcFormattedBodyHtml } from '../rrcFormattedBody';
import {
  bindNomadMicronMedia,
  bindNomadMicronPartials,
  buildNomadLinkRequest,
  canonicalNomadPageResourceKey,
  collectNomadFormFieldValues,
  formatNomadRequestDataForUrlBar,
  isNomadFilePath,
  isNomadMediaPath,
  isNomadMicronPage,
  loadNomadMicronPartial,
  MICRON_RENDER_LIMITS,
  MicronParser,
  mountNomadMicronHtml,
  NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY,
  NOMAD_MICRON_PARTIAL_LIMITS,
  nomadPageRequestDataEquals,
  normalizeNomadPageRequestData,
  parseNomadLinkFieldsSpec,
  parseNomadNetworkLinkUrl,
  renderNomadMicronPage,
  resolveNomadMediaFetchTarget,
  resolveNomadPartialResourceKey,
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

  it('draws character dividers with bounded CSS instead of repeated text', () => {
    const html = renderNomadMicronPage(['-=', 'text'].join('\n'));
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);
    const divider = container.querySelector<HTMLElement>('.nomad-micron-divider');
    expect(divider?.textContent).toBe('');
    expect(divider?.getAttribute('role')).toBe('separator');
    expect(divider?.style.width).toBe('100%');
    expect(divider?.style.borderTopStyle).toBe('solid');
    expect(divider?.style.borderTopWidth).toBe('1px');
  });

  it('rejects a maximum-size divider page before building amplified output', () => {
    const attack = '-=\n'.repeat(Math.floor(MICRON_RENDER_LIMITS.sourceChars / 3));
    const html = renderNomadMicronPage(attack);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, html);

    expect(container.querySelector('[data-micron-render-error="true"]')).not.toBeNull();
    expect(container.querySelector('.nomad-micron-divider')).toBeNull();
    expect(html.length).toBeLessThan(256);
  });

  it('enforces exact source, line-count, line-length, and nesting boundaries', () => {
    const exactSource = `${'x'.repeat(MICRON_RENDER_LIMITS.lineChars - 1)}\n`.repeat(
      MICRON_RENDER_LIMITS.sourceChars / MICRON_RENDER_LIMITS.lineChars,
    );
    expect(exactSource).toHaveLength(MICRON_RENDER_LIMITS.sourceChars);
    expect(renderNomadMicronPage(exactSource)).not.toContain('data-micron-render-error');
    expect(renderNomadMicronPage(`${exactSource}x`)).toContain('data-micron-render-error');

    const exactLines = Array(MICRON_RENDER_LIMITS.sourceLines).fill('#').join('\n');
    expect(renderNomadMicronPage(exactLines)).not.toContain('data-micron-render-error');
    expect(renderNomadMicronPage(`${exactLines}\n#`)).toContain('data-micron-render-error');

    expect(renderNomadMicronPage('x'.repeat(MICRON_RENDER_LIMITS.lineChars))).not.toContain(
      'data-micron-render-error',
    );
    expect(renderNomadMicronPage('x'.repeat(MICRON_RENDER_LIMITS.lineChars + 1))).toContain(
      'data-micron-render-error',
    );

    expect(
      renderNomadMicronPage(`${'>'.repeat(MICRON_RENDER_LIMITS.nestingDepth)} heading`),
    ).not.toContain('data-micron-render-error');
    expect(
      renderNomadMicronPage(`${'>'.repeat(MICRON_RENDER_LIMITS.nestingDepth + 1)} heading`),
    ).toContain('data-micron-render-error');
    expect(
      renderNomadMicronPage(`${'<'.repeat(MICRON_RENDER_LIMITS.nestingDepth + 1)}text`),
    ).toContain('data-micron-render-error');
  });

  it('caps table rows, columns, and total cells before mounting the table', () => {
    const allowedRows = [
      '`t',
      'Name',
      '---',
      ...Array.from({ length: MICRON_RENDER_LIMITS.tableRows }, (_, index) => `row ${index}`),
      '`t',
    ].join('\n');
    expect(renderNomadMicronPage(allowedRows)).not.toContain('data-micron-render-error');

    const excessRows = allowedRows.replace('\n`t', '\none too many\n`t');
    expect(renderNomadMicronPage(excessRows)).toContain('data-micron-render-error');

    const excessColumns = `${Array(MICRON_RENDER_LIMITS.tableColumns + 1)
      .fill('h')
      .join('|')}\n${Array(MICRON_RENDER_LIMITS.tableColumns + 1)
      .fill('---')
      .join('|')}`;
    expect(renderNomadMicronPage(['`t', excessColumns, '`t'].join('\n'))).toContain(
      'data-micron-render-error',
    );

    const cellsPerRow = 64;
    const totalCellOverflow = [
      '`t',
      Array(cellsPerRow).fill('h').join('|'),
      Array(cellsPerRow).fill('---').join('|'),
      ...Array.from({ length: 64 }, () => Array(cellsPerRow).fill('x').join('|')),
      '`t',
    ].join('\n');
    expect(renderNomadMicronPage(totalCellOverflow)).toContain('data-micron-render-error');
  });

  it('applies the same budgets to complex markup and direct fragment conversion', () => {
    const complex = '\u2603'.repeat(MICRON_RENDER_LIMITS.lineChars);
    expect(renderNomadMicronPage(complex)).toContain('data-micron-render-error');

    const parser = new MicronParser();
    const fragment = parser.convertMicronToFragment('x'.repeat(MICRON_RENDER_LIMITS.lineChars + 1));
    expect(fragment.querySelector('[data-micron-render-error="true"]')).not.toBeNull();
    expect(fragment.childElementCount).toBe(1);
  });

  it('counts the returned root in the exact element boundary for HTML and fragments', () => {
    const exactElements = '\n'.repeat(MICRON_RENDER_LIMITS.elements - 2);
    const html = renderNomadMicronPage(exactElements);
    const mounted = document.createElement('div');
    mountNomadMicronHtml(mounted, html);
    expect(mounted.querySelectorAll('*')).toHaveLength(MICRON_RENDER_LIMITS.elements);

    const parser = new MicronParser();
    const fragment = parser.convertMicronToFragment(exactElements);
    expect(fragment.querySelectorAll('*')).toHaveLength(MICRON_RENDER_LIMITS.elements);

    const excessElements = `${exactElements}\n`;
    expect(renderNomadMicronPage(excessElements)).toContain('data-micron-render-error');
    expect(
      parser
        .convertMicronToFragment(excessElements)
        .querySelector('[data-micron-render-error="true"]'),
    ).not.toBeNull();
  }, 20_000);

  it('resolves empty anchors in linear document order', () => {
    const compareSpy = vi.spyOn(Node.prototype, 'compareDocumentPosition');
    try {
      const markup = `${Array(3_000).fill('> a').join('\n')}\n${Array(3_000)
        .fill('`[#]')
        .join('')}`;
      const html = renderNomadMicronPage(markup);
      expect(html).not.toContain('data-micron-render-error');
      // DOMPurify/jsdom performs linear document-position checks internally; the parser must not
      // reintroduce the prior 9,000,000-comparison links × headings scan.
      expect(compareSpy.mock.calls.length).toBeLessThan(10_000);
    } finally {
      compareSpy.mockRestore();
    }
  }, 20_000);

  it('coalesces same-style output before invoking the sanitizer', () => {
    const sanitizeSpy = vi.spyOn(DOMPurify, 'sanitize');
    try {
      const html = renderNomadMicronPage('a`Z'.repeat(4_000));
      expect(html).not.toContain('data-micron-render-error');
      expect(sanitizeSpy.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      sanitizeSpy.mockRestore();
    }
  });

  it('applies the same safe rejection to formatted RRC bodies', () => {
    const html = renderRrcFormattedBodyHtml('x'.repeat(MICRON_RENDER_LIMITS.lineChars + 1));
    expect(html).toContain('data-micron-render-error="true"');
    expect(html).not.toContain('x'.repeat(64));
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
  it('fetches raw Micron source with its byte size and includes form field request data', async () => {
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
    expect(result.source).toBe('`!Partial body:`!');
    expect(result.sourceBytes).toBe(new TextEncoder().encode(result.source).byteLength);
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

  it('mounts only the safe render rejection for an oversized partial', async () => {
    const container = document.createElement('div');
    mountNomadMicronHtml(container, renderNomadMicronPage('`{:/page/large.mu}'));
    const cleanup = bindNomadMicronPartials(container, (info) =>
      loadNomadMicronPartial({
        destination: info.destination,
        fields: info.fields,
        signal: info.signal,
        defaultPagePath: '/page/index.mu',
        selectedHash: 'd'.repeat(32),
        formContainer: null,
        fetchPage: vi.fn().mockResolvedValue({
          ok: true,
          content: 'x'.repeat(MICRON_RENDER_LIMITS.lineChars + 1),
        }),
      }),
    );

    await vi.waitFor(() => {
      expect(container.querySelector('[data-micron-render-error="true"]')).not.toBeNull();
    });
    expect(container.textContent).not.toContain('x'.repeat(64));
    cleanup();
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

  it('canonicalizes partial ancestry and rejects a direct page cycle before fetching', async () => {
    const hash = 'A'.repeat(32);
    expect(canonicalNomadPageResourceKey(hash, '//page/dir/.././index.mu')).toBe(
      `${hash.toLowerCase()}:/page/index.mu`,
    );

    const container = document.createElement('div');
    mountNomadMicronHtml(
      container,
      renderNomadMicronPage('`{aaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAA:/page/./index.mu}'),
    );
    const fetcher = vi.fn();
    const cleanup = bindNomadMicronPartials(container, fetcher, {
      rootResourceKey: canonicalNomadPageResourceKey(hash, '/page/index.mu'),
      resolveResourceKey: (info) =>
        resolveNomadPartialResourceKey(info.destination, hash, '/page/index.mu'),
    });

    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector('.Mu-partial')).toHaveAttribute(
      'data-partial-error',
      'partial_cycle',
    );
    cleanup();
  });

  it('rejects an indirect partial cycle in the same page controller', async () => {
    const hash = 'b'.repeat(32);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, renderNomadMicronPage('`{:/page/b.mu}'));
    const fetcher = vi.fn().mockResolvedValue({
      markup: renderNomadMicronPage('`{:/page/dir/../index.mu}'),
      sourceBytes: 32,
    });
    const cleanup = bindNomadMicronPartials(container, fetcher, {
      rootResourceKey: canonicalNomadPageResourceKey(hash, '/page/index.mu'),
      resolveResourceKey: (info) =>
        resolveNomadPartialResourceKey(info.destination, hash, '/page/index.mu'),
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-partial-error="partial_cycle"]')).not.toBeNull();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('serializes eager fanout and aborts queued work on cleanup', async () => {
    const container = document.createElement('div');
    mountNomadMicronHtml(
      container,
      renderNomadMicronPage(
        Array.from({ length: 4 }, (_, index) => `\`{:/page/${index}.mu}`).join('\n'),
      ),
    );
    const resolvers: ((value: { markup: string; sourceBytes: number }) => void)[] = [];
    const seenSignals: (AbortSignal | null)[] = [];
    let active = 0;
    let maxActive = 0;
    const fetcher = vi.fn((info: { signal: AbortSignal | null }) => {
      seenSignals.push(info.signal);
      return new Promise<{ markup: string; sourceBytes: number }>((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        resolvers.push((value) => {
          active -= 1;
          resolve(value);
        });
      });
    });
    const cleanup = bindNomadMicronPartials(container, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    resolvers.shift()?.({ markup: 'first', sourceBytes: 5 });
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    expect(maxActive).toBe(NOMAD_MICRON_PARTIAL_LIMITS.maxConcurrency);
    const secondSignal = seenSignals[1]!;
    cleanup();
    expect(secondSignal.aborted).toBe(true);
    resolvers.shift()?.({ markup: 'late', sourceBytes: 4 });
    await Promise.resolve();
    expect(container.textContent).not.toContain('late');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('enforces partial count, refresh timer, and aggregate byte ceilings', async () => {
    const countContainer = document.createElement('div');
    mountNomadMicronHtml(
      countContainer,
      renderNomadMicronPage(
        Array.from(
          { length: NOMAD_MICRON_PARTIAL_LIMITS.maxPartials + 1 },
          (_, index) => `\`{:/page/count-${index}.mu}`,
        ).join('\n'),
      ),
    );
    const countCleanup = bindNomadMicronPartials(countContainer, () => new Promise(() => {}));
    expect(
      countContainer.querySelector('[data-partial-error="partial_count_limit"]'),
    ).not.toBeNull();
    countCleanup();

    const timerContainer = document.createElement('div');
    mountNomadMicronHtml(
      timerContainer,
      renderNomadMicronPage(
        Array.from(
          { length: NOMAD_MICRON_PARTIAL_LIMITS.maxRefreshTimers + 1 },
          (_, index) => `\`{:/page/timer-${index}.mu\`1}`,
        ).join('\n'),
      ),
    );
    const timerCleanup = bindNomadMicronPartials(timerContainer, () => new Promise(() => {}));
    expect(
      timerContainer.querySelectorAll('[data-partial-refresh-error="partial_timer_limit"]'),
    ).toHaveLength(1);
    timerCleanup();

    const byteContainer = document.createElement('div');
    mountNomadMicronHtml(
      byteContainer,
      renderNomadMicronPage('`{:/page/one.mu}\n`{:/page/two.mu}'),
    );
    const renderSpy = vi.spyOn(MicronParser.prototype, 'convertMicronToHtml');
    const byteFetcher = vi
      .fn()
      .mockResolvedValueOnce({
        source: 'within',
        sourceBytes: NOMAD_MICRON_PARTIAL_LIMITS.maxSourceBytes,
      })
      .mockResolvedValueOnce({ source: 'over', sourceBytes: 1 });
    const byteCleanup = bindNomadMicronPartials(byteContainer, byteFetcher);
    await vi.waitFor(() => {
      expect(byteFetcher).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(
        byteContainer.querySelector('[data-partial-error="partial_source_byte_limit"]'),
      ).not.toBeNull();
    });
    expect(byteContainer.textContent).toContain('within');
    expect(byteContainer.textContent).not.toContain('over');
    expect(renderSpy).not.toHaveBeenCalledWith('over');
    renderSpy.mockRestore();
    byteCleanup();
  });

  it('enforces the recursive depth ceiling', async () => {
    const hash = 'c'.repeat(32);
    const container = document.createElement('div');
    mountNomadMicronHtml(container, renderNomadMicronPage('`{:/page/1.mu}'));
    let response = 1;
    const fetcher = vi.fn().mockImplementation(() => {
      response += 1;
      return Promise.resolve({
        markup: renderNomadMicronPage(`\`{:/page/${response}.mu}`),
        sourceBytes: 24,
      });
    });
    const cleanup = bindNomadMicronPartials(container, fetcher, {
      rootResourceKey: canonicalNomadPageResourceKey(hash, '/page/root.mu'),
      resolveResourceKey: (info) =>
        resolveNomadPartialResourceKey(info.destination, hash, '/page/root.mu'),
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-partial-error="partial_depth_limit"]')).not.toBeNull();
    });
    expect(fetcher).toHaveBeenCalledTimes(NOMAD_MICRON_PARTIAL_LIMITS.maxDepth);
    cleanup();
  });

  it('keeps the network slot until a descendant settles, then clears its refresh timer', async () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      mountNomadMicronHtml(container, renderNomadMicronPage('`{:/page/parent.mu}'));
      let parentCalls = 0;
      let childCalls = 0;
      const childSignals: (AbortSignal | null)[] = [];
      const childResolvers: ((value: { markup: string; sourceBytes: number }) => void)[] = [];
      const fetcher = vi.fn((info: { destination: string; signal: AbortSignal | null }) => {
        if (info.destination.includes('parent.mu')) {
          parentCalls += 1;
          return Promise.resolve({
            markup:
              parentCalls === 1
                ? renderNomadMicronPage('`{:/page/child.mu`1}')
                : renderNomadMicronPage('PARENT_REFRESHED'),
            sourceBytes: 32,
          });
        }
        childCalls += 1;
        childSignals.push(info.signal);
        return new Promise<{ markup: string; sourceBytes: number }>((resolve) => {
          childResolvers.push(resolve);
        });
      });
      const cleanup = bindNomadMicronPartials(container, fetcher);
      await vi.advanceTimersByTimeAsync(0);
      expect(parentCalls).toBe(1);
      expect(childCalls).toBe(1);

      cleanup.reload?.((info) => info.destination.includes('parent.mu'));
      await vi.advanceTimersByTimeAsync(0);
      expect(childSignals[0]?.aborted).toBe(false);
      expect(parentCalls).toBe(1);

      childResolvers[0]?.({ markup: 'CHILD_SETTLED', sourceBytes: 8 });
      await vi.advanceTimersByTimeAsync(0);
      expect(parentCalls).toBe(2);
      expect(container.textContent).toContain('PARENT_REFRESHED');

      await vi.advanceTimersByTimeAsync(1500);
      expect(childCalls).toBe(1);
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the existing descendant subtree live when a parent refresh fails', async () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      mountNomadMicronHtml(container, renderNomadMicronPage('`{:/page/parent.mu}'));
      let parentCalls = 0;
      let childCalls = 0;
      const fetcher = vi.fn((info: { destination: string }) => {
        if (info.destination.includes('parent.mu')) {
          parentCalls += 1;
          if (parentCalls > 1) return Promise.reject(new Error('refresh_failed'));
          return Promise.resolve({
            markup: renderNomadMicronPage('`{:/page/child.mu`1}'),
            sourceBytes: 32,
          });
        }
        childCalls += 1;
        return Promise.resolve({ markup: `CHILD_${childCalls}`, sourceBytes: 8 });
      });
      const cleanup = bindNomadMicronPartials(container, fetcher);
      await vi.advanceTimersByTimeAsync(0);
      expect(childCalls).toBe(1);

      cleanup.reload?.((info) => info.destination.includes('parent.mu'));
      await vi.advanceTimersByTimeAsync(0);
      expect(parentCalls).toBe(2);
      expect(container.querySelector('[data-partial-error="refresh_failed"]')).not.toBeNull();
      expect(container.textContent).toContain('CHILD_1');

      await vi.advanceTimersByTimeAsync(1000);
      expect(childCalls).toBe(2);
      expect(container.textContent).toContain('CHILD_2');
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the existing descendant subtree live when a parent refresh cannot render', async () => {
    vi.useFakeTimers();
    try {
      const container = document.createElement('div');
      mountNomadMicronHtml(container, renderNomadMicronPage('`{:/page/parent.mu}'));
      let parentCalls = 0;
      let childCalls = 0;
      const fetcher = vi.fn((info: { destination: string }) => {
        if (info.destination.includes('parent.mu')) {
          parentCalls += 1;
          const source = parentCalls === 1 ? '`{:/page/child.mu`1}' : 'PARENT_RENDER_MUST_FAIL';
          return Promise.resolve({ source, sourceBytes: source.length });
        }
        childCalls += 1;
        return Promise.resolve({ markup: `CHILD_${childCalls}`, sourceBytes: 8 });
      });
      const cleanup = bindNomadMicronPartials(container, fetcher);
      await vi.advanceTimersByTimeAsync(0);
      expect(childCalls).toBe(1);

      const originalConvert = MicronParser.prototype.convertMicronToHtml;
      const renderSpy = vi
        .spyOn(MicronParser.prototype, 'convertMicronToHtml')
        .mockImplementation(function (this: MicronParser, source: string) {
          if (source === 'PARENT_RENDER_MUST_FAIL') throw new Error('render_failed');
          return originalConvert.call(this, source);
        });
      cleanup.reload?.((info) => info.destination.includes('parent.mu'));
      await vi.advanceTimersByTimeAsync(0);
      renderSpy.mockRestore();

      expect(parentCalls).toBe(2);
      expect(container.querySelector('[data-partial-error="render_failed"]')).not.toBeNull();
      expect(container.textContent).toContain('CHILD_1');

      await vi.advanceTimersByTimeAsync(1000);
      expect(childCalls).toBe(2);
      expect(container.textContent).toContain('CHILD_2');
      cleanup();
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('enforces the total request budget and page-controller lifetime', async () => {
    vi.useFakeTimers();
    try {
      const rateContainer = document.createElement('div');
      mountNomadMicronHtml(rateContainer, renderNomadMicronPage('`{:/page/rate.mu}'));
      const rateFetcher = vi.fn().mockResolvedValue({ markup: 'ok', sourceBytes: 1 });
      const rateCleanup = bindNomadMicronPartials(rateContainer, rateFetcher);
      await vi.advanceTimersByTimeAsync(0);
      for (let index = 1; index < NOMAD_MICRON_PARTIAL_LIMITS.maxRequestsPerMinute; index += 1) {
        rateCleanup.reload?.();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(rateFetcher).toHaveBeenCalledTimes(NOMAD_MICRON_PARTIAL_LIMITS.maxRequestsPerMinute);
      rateCleanup.reload?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(
        rateContainer.querySelector('[data-partial-error="partial_request_rate_limit"]'),
      ).not.toBeNull();
      rateCleanup();

      const requestContainer = document.createElement('div');
      mountNomadMicronHtml(requestContainer, renderNomadMicronPage('`{:/page/reload.mu}'));
      const requestFetcher = vi.fn().mockResolvedValue({ markup: 'ok', sourceBytes: 1 });
      const requestCleanup = bindNomadMicronPartials(requestContainer, requestFetcher);
      await vi.advanceTimersByTimeAsync(0);

      for (let index = 1; index < NOMAD_MICRON_PARTIAL_LIMITS.maxRequests; index += 1) {
        await vi.advanceTimersByTimeAsync(1001);
        requestCleanup.reload?.();
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(requestFetcher).toHaveBeenCalledTimes(NOMAD_MICRON_PARTIAL_LIMITS.maxRequests);

      await vi.advanceTimersByTimeAsync(1001);
      requestCleanup.reload?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(requestFetcher).toHaveBeenCalledTimes(NOMAD_MICRON_PARTIAL_LIMITS.maxRequests);
      expect(
        requestContainer.querySelector('[data-partial-error="partial_request_limit"]'),
      ).not.toBeNull();
      requestCleanup();

      const lifetimeContainer = document.createElement('div');
      mountNomadMicronHtml(lifetimeContainer, renderNomadMicronPage('`{:/page/slow.mu}'));
      const signals: (AbortSignal | null)[] = [];
      const onPaused = vi.fn();
      const lifetimeCleanup = bindNomadMicronPartials(
        lifetimeContainer,
        (info) => {
          signals.push(info.signal);
          return new Promise(() => {});
        },
        { onPaused },
      );
      expect(signals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(NOMAD_MICRON_PARTIAL_LIMITS.maxLifetimeMs);
      expect(signals[0]?.aborted).toBe(true);
      expect(onPaused).toHaveBeenCalledTimes(1);
      lifetimeCleanup();
      expect(onPaused).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

  it('serializes /media fetches (concurrency 1, NomadNet Link parity)', async () => {
    const lines = Array.from({ length: 4 }, (_, i) => `\`(Img ${i}\`:/media/i${i}.webp)`);
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

    expect(fetchMedia).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(1);
    expect(NOMAD_MICRON_MEDIA_FETCH_CONCURRENCY).toBe(1);
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
