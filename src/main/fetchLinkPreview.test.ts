// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agentConnectOpts } = vi.hoisted(() => ({
  agentConnectOpts: [] as { port?: number }[],
}));

vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(),
  },
  lookup: vi.fn(),
}));

vi.mock('undici', () => {
  class MockAgent {
    constructor(opts: { connect?: { port?: number } }) {
      if (opts.connect) agentConnectOpts.push(opts.connect);
    }
    close = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Agent: MockAgent,
    fetch: vi.fn(),
  };
});

import dns from 'node:dns/promises';

import { fetch as undiciFetch } from 'undici';

import {
  canonicalizeYouTubeWatchUrl,
  clearLinkPreviewCachesForTests,
  fetchLinkPreview,
  isBlockedHostname,
  isBlockedHostnameResolved,
  isLikelyDirectImageUrl,
  isLinkPreviewImageMime,
  isYouTubePreviewHostname,
  LINK_PREVIEW_RATE_LIMIT_MAX,
  shouldProxyPreviewImageUrl,
} from './fetchLinkPreview';

const mockDnsLookup = vi.mocked(dns.lookup);
const mockFetch = vi.mocked(undiciFetch);

type UndiciFetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

function mockUndiciResponse(partial: object): UndiciFetchResponse {
  return partial as UndiciFetchResponse;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockDnsLookup.mockReset();
  mockDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
  agentConnectOpts.length = 0;
  clearLinkPreviewCachesForTests();
});

afterEach(() => {
  mockFetch.mockReset();
  clearLinkPreviewCachesForTests();
});

function makeStreamResponse(
  html: string,
  contentType = 'text/html; charset=utf-8',
): UndiciFetchResponse {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(html);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return mockUndiciResponse({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': contentType }),
    body: stream,
  });
}

function fetchRequestHostname(input: string | URL | Request): string | null {
  try {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

describe('isBlockedHostname', () => {
  it('blocks dotted-decimal IPv4', () => {
    expect(isBlockedHostname('192.168.1.1')).toBe(true);
    expect(isBlockedHostname('10.0.0.1')).toBe(true);
    expect(isBlockedHostname('127.0.0.1')).toBe(true);
  });

  it('blocks localhost', () => {
    expect(isBlockedHostname('localhost')).toBe(true);
    expect(isBlockedHostname('LOCALHOST')).toBe(true);
  });

  it('blocks IPv6 loopback forms', () => {
    expect(isBlockedHostname('[::1]')).toBe(true);
    expect(isBlockedHostname('::1')).toBe(true);
  });

  it('blocks 0.0.0.0', () => {
    expect(isBlockedHostname('0.0.0.0')).toBe(true);
  });

  it('allows public hostnames', () => {
    expect(isBlockedHostname('example.com')).toBe(false);
    expect(isBlockedHostname('sub.example.org')).toBe(false);
  });
});

describe('isBlockedHostnameResolved', () => {
  it('blocks hostnames that resolve to private IPv4', async () => {
    mockDnsLookup.mockResolvedValue({ address: '10.0.0.5', family: 4 });
    await expect(isBlockedHostnameResolved('metadata.example.internal')).resolves.toBe(true);
  });

  it('allows hostnames that resolve to public IPv4', async () => {
    mockDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(isBlockedHostnameResolved('example.com')).resolves.toBe(false);
  });

  it('blocks when DNS lookup fails', async () => {
    mockDnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(isBlockedHostnameResolved('missing.example.com')).resolves.toBe(true);
  });
});

describe('shouldProxyPreviewImageUrl', () => {
  it('proxies GitHub opengraph CDN', () => {
    expect(
      shouldProxyPreviewImageUrl(
        'https://opengraph.githubassets.com/52768cefbf1a3fa13ca046289d01a61233c6ad064abe523c29e2cf8e7771f81b/Colorado-Mesh/mesh-client',
      ),
    ).toBe(true);
  });

  it('does not proxy arbitrary image hosts', () => {
    expect(shouldProxyPreviewImageUrl('https://example.com/img.png')).toBe(false);
  });
});

describe('isLinkPreviewImageMime / isLikelyDirectImageUrl', () => {
  it('accepts raster MIME types and rejects svg/json', () => {
    expect(isLinkPreviewImageMime('image/jpeg; charset=binary')).toBe(true);
    expect(isLinkPreviewImageMime('image/png')).toBe(true);
    expect(isLinkPreviewImageMime('image/webp')).toBe(true);
    expect(isLinkPreviewImageMime('image/svg+xml')).toBe(false);
    expect(isLinkPreviewImageMime('application/json')).toBe(false);
  });

  it('detects image path extensions ignoring query', () => {
    expect(isLikelyDirectImageUrl('https://cdn.example.com/a/photo.JPG?w=800')).toBe(true);
    expect(isLikelyDirectImageUrl('https://cdn.example.com/a/photo.png')).toBe(true);
    expect(isLikelyDirectImageUrl('https://cdn.example.com/a/photo.webp')).toBe(true);
    expect(isLikelyDirectImageUrl('https://example.com/page')).toBe(false);
    expect(isLikelyDirectImageUrl('not a url')).toBe(false);
  });
});

describe('YouTube URL helpers', () => {
  it('recognizes YouTube hosts', () => {
    expect(isYouTubePreviewHostname('www.youtube.com')).toBe(true);
    expect(isYouTubePreviewHostname('youtu.be')).toBe(true);
    expect(isYouTubePreviewHostname('m.youtube.com')).toBe(true);
    expect(isYouTubePreviewHostname('example.com')).toBe(false);
  });

  it('canonicalizes watch, short, embed, and youtu.be URLs', () => {
    expect(canonicalizeYouTubeWatchUrl(new URL('https://youtu.be/dQw4w9WgXcQ'))).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(
      canonicalizeYouTubeWatchUrl(new URL('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')),
    ).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(canonicalizeYouTubeWatchUrl(new URL('https://www.youtube.com/shorts/dQw4w9WgXcQ'))).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(canonicalizeYouTubeWatchUrl(new URL('https://www.youtube.com/embed/dQw4w9WgXcQ'))).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    expect(canonicalizeYouTubeWatchUrl(new URL('https://www.youtube.com/'))).toBeNull();
  });
});

describe('fetchLinkPreview', () => {
  it('returns null for invalid URL', async () => {
    expect(await fetchLinkPreview('not a url')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for non-http(s) protocols', async () => {
    expect(await fetchLinkPreview('ftp://example.com')).toBeNull();
    expect(await fetchLinkPreview('file:///etc/passwd')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for localhost URLs (SSRF guard)', async () => {
    expect(await fetchLinkPreview('http://localhost/admin')).toBeNull();
    expect(await fetchLinkPreview('http://localhost:8080/api')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for IPv6 loopback URLs (SSRF guard)', async () => {
    expect(await fetchLinkPreview('http://[::1]/')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null for IPv4 address URLs', async () => {
    expect(await fetchLinkPreview('http://192.168.1.1/')).toBeNull();
    expect(await fetchLinkPreview('http://10.0.0.1/path')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when fetch response is not ok', async () => {
    mockFetch.mockResolvedValue(
      mockUndiciResponse({ ok: false, status: 404, headers: new Headers() }),
    );
    expect(await fetchLinkPreview('https://example.com/missing')).toBeNull();
  });

  it('returns null for redirects (redirect:manual gives ok=false)', async () => {
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: false,
        status: 301,
        headers: new Headers(),
        type: 'opaqueredirect',
      }),
    );
    expect(await fetchLinkPreview('https://example.com')).toBeNull();
  });

  it('passes redirect:manual to fetch', async () => {
    mockFetch.mockResolvedValue(
      mockUndiciResponse({ ok: false, status: 301, headers: new Headers() }),
    );
    await fetchLinkPreview('https://example.com');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('returns null for non-HTML non-image content-type', async () => {
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      }),
    );
    expect(await fetchLinkPreview('https://example.com/api')).toBeNull();
  });

  it('returns kind:image for direct https JPEG/PNG URLs', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(pngBytes);
            c.close();
          },
        }),
      }),
    );
    const result = await fetchLinkPreview('https://cdn.example.com/photos/shot.png');
    expect(result).toEqual({
      title: 'shot.png',
      image: expect.stringMatching(/^data:image\/png;base64,/),
      kind: 'image',
    });
  });

  it('returns kind:image for image/* Content-Type without path extension', async () => {
    const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg; charset=binary' }),
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(jpegBytes);
            c.close();
          },
        }),
      }),
    );
    const result = await fetchLinkPreview('https://cdn.example.com/media/abc123');
    expect(result).toEqual({
      title: 'abc123',
      image: expect.stringMatching(/^data:image\/jpeg;base64,/),
      kind: 'image',
    });
  });

  it('rejects direct image/svg+xml URL bodies', async () => {
    const svgBytes = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/svg+xml' }),
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(svgBytes);
            c.close();
          },
        }),
      }),
    );
    expect(await fetchLinkPreview('https://cdn.example.com/x.svg')).toBeNull();
  });

  it('fetches YouTube watch URLs via oEmbed (title + thumbnail)', async () => {
    const thumbBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    const oembed = {
      title: 'Never Gonna Give You Up',
      author_name: 'Rick Astley',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    };
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.includes('youtube.com/oembed')) {
        const json = JSON.stringify(oembed);
        return Promise.resolve(makeStreamResponse(json, 'application/json'));
      }
      if (fetchRequestHostname(input) === 'i.ytimg.com') {
        return Promise.resolve(
          mockUndiciResponse({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            body: new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(thumbBytes);
                c.close();
              },
            }),
          }),
        );
      }
      return Promise.resolve(
        mockUndiciResponse({ ok: false, status: 404, headers: new Headers() }),
      );
    }) as typeof undiciFetch);

    const result = await fetchLinkPreview('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(result).toEqual({
      title: 'Never Gonna Give You Up',
      description: 'Rick Astley',
      image: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(
      mockFetch.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('/oembed?')),
    ).toBe(true);
  });

  it('fetches youtu.be and shorts URLs via oEmbed', async () => {
    const oembed = {
      title: 'Short clip',
      author_name: 'Creator',
      thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    };
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.includes('youtube.com/oembed')) {
        expect(href).toContain(encodeURIComponent('https://www.youtube.com/watch?v=abcdefghijk'));
        return Promise.resolve(makeStreamResponse(JSON.stringify(oembed), 'application/json'));
      }
      if (fetchRequestHostname(input) === 'i.ytimg.com') {
        return Promise.resolve(
          mockUndiciResponse({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/jpeg' }),
            body: new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(Uint8Array.from([0xff, 0xd8]));
                c.close();
              },
            }),
          }),
        );
      }
      return Promise.resolve(
        mockUndiciResponse({ ok: false, status: 404, headers: new Headers() }),
      );
    }) as typeof undiciFetch);

    const short = await fetchLinkPreview('https://youtu.be/abcdefghijk');
    expect(short?.title).toBe('Short clip');
    clearLinkPreviewCachesForTests();

    const shorts = await fetchLinkPreview('https://www.youtube.com/shorts/abcdefghijk');
    expect(shorts?.title).toBe('Short clip');
  });

  it('returns null when body is null', async () => {
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: null,
      }),
    );
    expect(await fetchLinkPreview('https://example.com')).toBeNull();
  });

  it('returns null when body is empty', async () => {
    const emptyStream = new ReadableStream<Uint8Array>({
      start(c) {
        c.close();
      },
    });
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: emptyStream,
      }),
    );
    expect(await fetchLinkPreview('https://example.com')).toBeNull();
  });

  it('returns null when OG title is absent', async () => {
    mockFetch.mockResolvedValue(makeStreamResponse('<html><body>no title here</body></html>'));
    expect(await fetchLinkPreview('https://example.com')).toBeNull();
  });

  it('parses og:title in property-first attribute order', async () => {
    const html = `<meta property="og:title" content="My Page Title">`;
    mockFetch.mockResolvedValue(makeStreamResponse(html));
    const result = await fetchLinkPreview('https://example.com');
    expect(result?.title).toBe('My Page Title');
  });

  it('parses og:title in content-first attribute order', async () => {
    const html = `<meta content="Reversed Title" property="og:title">`;
    mockFetch.mockResolvedValue(makeStreamResponse(html));
    const result = await fetchLinkPreview('https://example.com');
    expect(result?.title).toBe('Reversed Title');
  });

  it('falls back to <title> tag when og:title absent', async () => {
    const html = `<html><head><title>Plain Title</title></head></html>`;
    mockFetch.mockResolvedValue(makeStreamResponse(html));
    const result = await fetchLinkPreview('https://example.com');
    expect(result?.title).toBe('Plain Title');
  });

  it('proxies https og:image URLs as data URLs in main (SSRF guard)', async () => {
    const html = [
      `<meta property="og:title" content="Title">`,
      `<meta property="og:description" content="Desc text">`,
      `<meta property="og:image" content="https://example.com/img.png">`,
    ].join('\n');
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      const host = fetchRequestHostname(input);
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let path = '';
      try {
        path = new URL(href).pathname;
      } catch {
        // catch-no-log-ok test mock may receive partial URLs
      }
      if (host === 'example.com' && path.endsWith('/img.png')) {
        return Promise.resolve(
          mockUndiciResponse({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            body: new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(pngBytes);
                c.close();
              },
            }),
          }),
        );
      }
      return Promise.resolve(makeStreamResponse(html));
    }) as typeof undiciFetch);
    const result = await fetchLinkPreview('https://example.com');
    expect(result).toEqual({
      title: 'Title',
      description: 'Desc text',
      image: expect.stringMatching(/^data:image\/png;base64,/),
    });
  });

  it('rejects image/svg+xml og:image responses (XML script/entity risk)', async () => {
    const html = [
      `<meta property="og:title" content="SVG trap">`,
      `<meta property="og:image" content="https://example.com/img.svg">`,
    ].join('\n');
    const svgBytes = new TextEncoder().encode('<svg onload="alert(1)"></svg>');
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      const host = fetchRequestHostname(input);
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      let path = '';
      try {
        path = new URL(href).pathname;
      } catch {
        // catch-no-log-ok test mock may receive partial URLs
      }
      if (host === 'example.com' && path.endsWith('/img.svg')) {
        return Promise.resolve(
          mockUndiciResponse({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/svg+xml' }),
            body: new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(svgBytes);
                c.close();
              },
            }),
          }),
        );
      }
      return Promise.resolve(makeStreamResponse(html));
    }) as typeof undiciFetch);

    const result = await fetchLinkPreview('https://example.com');
    expect(result?.title).toBe('SVG trap');
    expect(result?.image).toBeUndefined();
  });

  it('blocks proxied image fetch when og:image hostname resolves to private IPv4', async () => {
    const pageHtml = [
      `<meta property="og:title" content="DNS trap">`,
      `<meta property="og:image" content="https://opengraph.githubassets.com/abc/trap.png">`,
    ].join('\n');
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      const host = fetchRequestHostname(input);
      if (host === 'opengraph.githubassets.com') {
        return Promise.resolve(
          mockUndiciResponse({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            body: new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
                c.close();
              },
            }),
          }),
        );
      }
      return Promise.resolve(makeStreamResponse(pageHtml));
    }) as typeof undiciFetch);
    mockDnsLookup.mockImplementation((hostname: string) => {
      if (hostname === 'opengraph.githubassets.com') {
        return Promise.resolve({ address: '10.0.0.8', family: 4 });
      }
      return Promise.resolve({ address: '93.184.216.34', family: 4 });
    });

    const result = await fetchLinkPreview('https://example.com/page');
    expect(result?.title).toBe('DNS trap');
    expect(result?.image).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('blocks proxied image fetch when redirect targets a private host', async () => {
    const pageHtml = [
      `<meta property="og:title" content="Redirect trap">`,
      `<meta property="og:image" content="https://opengraph.githubassets.com/abc/trap.png">`,
    ].join('\n');
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      const host = fetchRequestHostname(input);
      if (host === 'opengraph.githubassets.com') {
        return Promise.resolve(
          mockUndiciResponse({
            ok: false,
            status: 302,
            headers: new Headers({ location: 'http://127.0.0.1/secret.png' }),
          }),
        );
      }
      return Promise.resolve(makeStreamResponse(pageHtml));
    }) as typeof undiciFetch);

    const result = await fetchLinkPreview('https://example.com/page');
    expect(result?.title).toBe('Redirect trap');
    expect(result?.image).toBeUndefined();
  });

  it('proxies GitHub opengraph images as data URLs in main', async () => {
    const pageHtml = [
      `<meta property="og:title" content="mesh-client">`,
      `<meta property="og:image" content="https://opengraph.githubassets.com/abc/Colorado-Mesh/mesh-client">`,
    ].join('\n');
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const imageStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pngBytes);
        controller.close();
      },
    });
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      if (fetchRequestHostname(input) === 'opengraph.githubassets.com') {
        return Promise.resolve(
          mockUndiciResponse({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            body: imageStream,
          }),
        );
      }
      return Promise.resolve(makeStreamResponse(pageHtml));
    }) as typeof undiciFetch);

    const result = await fetchLinkPreview('https://github.com/Colorado-Mesh/mesh-client');
    expect(result?.title).toBe('mesh-client');
    expect(result?.image).toMatch(/^data:image\/png;base64,/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('omits image when GitHub opengraph CDN returns 429', async () => {
    const pageHtml = [
      `<meta property="og:title" content="mesh-client">`,
      `<meta property="og:image" content="https://opengraph.githubassets.com/abc/Colorado-Mesh/mesh-client">`,
    ].join('\n');
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      if (fetchRequestHostname(input) === 'opengraph.githubassets.com') {
        return Promise.resolve(mockUndiciResponse({ ok: false, status: 429 }));
      }
      return Promise.resolve(makeStreamResponse(pageHtml));
    }) as typeof undiciFetch);

    const result = await fetchLinkPreview('https://github.com/Colorado-Mesh/mesh-client');
    expect(result).toEqual({ title: 'mesh-client', description: undefined, image: undefined });

    const cached = await fetchLinkPreview('https://github.com/Colorado-Mesh/mesh-client');
    expect(cached).toEqual(result);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('caches preview metadata by page URL', async () => {
    const html = `<meta property="og:title" content="Cached">`;
    mockFetch.mockResolvedValue(makeStreamResponse(html));
    await fetchLinkPreview('https://example.com/cached');
    await fetchLinkPreview('https://example.com/cached');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not charge cache hits against the uncached rate limit', async () => {
    const html = `<meta property="og:title" content="Cached">`;
    mockFetch.mockResolvedValue(makeStreamResponse(html));
    await fetchLinkPreview('https://example.com/rate-cache');
    for (let i = 0; i < LINK_PREVIEW_RATE_LIMIT_MAX + 5; i++) {
      expect(await fetchLinkPreview('https://example.com/rate-cache')).toEqual({
        title: 'Cached',
        description: undefined,
        image: undefined,
      });
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not charge joined in-flight requests against the uncached rate limit', async () => {
    let resolveFetch!: (value: UndiciFetchResponse) => void;
    const pending = new Promise<UndiciFetchResponse>((resolve) => {
      resolveFetch = resolve;
    });
    mockFetch.mockReturnValueOnce(pending);
    const p1 = fetchLinkPreview('https://example.com/dedup-rate');
    const p2 = fetchLinkPreview('https://example.com/dedup-rate');
    resolveFetch(makeStreamResponse(`<meta property="og:title" content="Dedup">`));
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      { title: 'Dedup', description: undefined, image: undefined },
      { title: 'Dedup', description: undefined, image: undefined },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rate-limits new uncached preview fetches', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeStreamResponse(`<meta property="og:title" content="T">`)),
    );
    for (let i = 0; i < LINK_PREVIEW_RATE_LIMIT_MAX; i++) {
      expect(await fetchLinkPreview(`https://example.com/rate-${i}`)).not.toBeNull();
    }
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      expect(await fetchLinkPreview('https://example.com/rate-overflow')).toBeNull();
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('rate limited'))).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('rejects http:// og:image (must be https)', async () => {
    const html = [
      `<meta property="og:title" content="Title">`,
      `<meta property="og:image" content="http://example.com/img.png">`,
    ].join('\n');
    mockFetch.mockResolvedValue(makeStreamResponse(html));
    const result = await fetchLinkPreview('https://example.com');
    expect(result?.image).toBeUndefined();
  });

  it('reads only up to LINK_PREVIEW_MAX_HTML_BYTES', async () => {
    const bigChunk = new Uint8Array(200_000).fill(65); // 200 KB of 'A'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bigChunk);
        controller.close();
      },
    });
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: stream,
      }),
    );
    // No title in 200KB of 'A's → returns null without OOMing
    expect(await fetchLinkPreview('https://example.com')).toBeNull();
  });

  it('returns null and logs on fetch error', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error('network failure'));
    expect(await fetchLinkPreview('https://example.com')).toBeNull();
    expect(debugSpy).toHaveBeenCalledWith(
      '[chat] fetchLinkPreview error:',
      expect.stringContaining('network failure'),
    );
  });

  it('returns null without unhandled rejection when body read times out', async () => {
    const timeoutErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        return Promise.reject(timeoutErr);
      },
      cancel() {
        return Promise.reject(timeoutErr);
      },
    });
    mockFetch.mockResolvedValue(
      mockUndiciResponse({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        body: stream,
      }),
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(await fetchLinkPreview('https://example.com/slow')).toBeNull();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('does not leave unhandled rejection when image body reader cancel rejects', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    const pageHtml = [
      `<meta property="og:title" content="mesh-client">`,
      `<meta property="og:image" content="https://opengraph.githubassets.com/abc/Colorado-Mesh/mesh-client">`,
    ].join('\n');
    const cancelErr = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    mockFetch.mockImplementation(((input: string | URL | Request) => {
      if (fetchRequestHostname(input) === 'opengraph.githubassets.com') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/png' }),
          body: {
            getReader: () => ({
              read: () => Promise.resolve({ done: true, value: undefined }),
              cancel: () => Promise.reject(cancelErr),
            }),
          },
        } as unknown as Response);
      }
      return Promise.resolve(makeStreamResponse(pageHtml));
    }) as typeof undiciFetch);

    const result = await fetchLinkPreview('https://github.com/Colorado-Mesh/mesh-client');
    expect(result?.title).toBe('mesh-client');
    expect(result?.image).toBeUndefined();
    expect(unhandled).toHaveLength(0);
    process.off('unhandledRejection', onUnhandled);
  });

  it('uses port 80 for http URLs without explicit port', async () => {
    const html = `<meta property="og:title" content="HTTP Title">`;
    mockFetch.mockResolvedValue(makeStreamResponse(html));
    await fetchLinkPreview('http://example.com/page');
    expect(agentConnectOpts.some((opts) => opts.port === 80)).toBe(true);
  });

  it('deduplicates concurrent preview fetches for the same URL', async () => {
    const html = `<meta property="og:title" content="Deduped">`;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(makeStreamResponse(html));
          }, 20);
        }),
    );
    const [a, b] = await Promise.all([
      fetchLinkPreview('https://example.com/dedup'),
      fetchLinkPreview('https://example.com/dedup'),
    ]);
    expect(a?.title).toBe('Deduped');
    expect(b?.title).toBe('Deduped');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns null when resolved address is private for HTML fetch', async () => {
    mockDnsLookup.mockResolvedValue({ address: '10.0.0.5', family: 4 });
    expect(await fetchLinkPreview('https://metadata.example.internal/page')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
