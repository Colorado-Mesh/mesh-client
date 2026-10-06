import { gzipSync } from 'node:zlib';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '6.0.0') },
  net: { isOnline: vi.fn(() => true) },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../validate-ipc-sender', () => ({ assertIpcSender: vi.fn() }));

import {
  SERVICE_ANNOUNCEMENT_FEED_URL,
  SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES,
} from '../../shared/serviceAnnouncementFeed';
import { assertIpcSender } from '../validate-ipc-sender';
import {
  createServiceAnnouncementFetcher,
  registerServiceAnnouncementIpcHandlers,
} from './service-announcement-handlers';

const row = {
  id: 'maint',
  severity: 'info',
  title: 'Maintenance',
  body: 'Body',
  url: 'https://example.com/notes',
};

function feedText(...rows: unknown[]): string {
  return JSON.stringify({ schema: 1, announcements: rows });
}

function response(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, ...init });
}

function setup(fetchImpl: typeof fetch, opts: { online?: boolean; version?: string } = {}) {
  return createServiceAnnouncementFetcher({
    fetchImpl,
    isOnline: () => opts.online ?? true,
    appVersion: () => opts.version ?? '6.0.0',
    feedUrl: SERVICE_ANNOUNCEMENT_FEED_URL,
  });
}

describe('createServiceAnnouncementFetcher', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  it('returns offline without fetching when net.isOnline() is false', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await setup(fetchImpl, { online: false }).check()).toEqual({ status: 'offline' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['ENOTFOUND', Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })],
    ['timeout', new DOMException('The operation timed out.', 'TimeoutError')],
    ['ECONNREFUSED', new Error('connect ECONNREFUSED 1.2.3.4:443')],
  ])('maps unreachable (%s) to offline with no warning', async (_label, err) => {
    const result = await setup(vi.fn<typeof fetch>().mockRejectedValue(err)).check();
    expect(result).toEqual({ status: 'offline' });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('parses a valid feed and filters by app version', async () => {
    const fetcher = setup(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response(feedText(row, { ...row, id: 'future', minAppVersion: '9.0.0' })),
        ),
    );
    const result = await fetcher.check();
    expect(result.status === 'ok' && result.announcements.map((a) => a.id)).toEqual(['maint']);
  });

  it.each([
    ['empty body', ''],
    ['whitespace body', '  \n '],
  ])('treats %s as no announcements', async (_label, body) => {
    expect(await setup(vi.fn<typeof fetch>().mockResolvedValue(response(body))).check()).toEqual({
      status: 'ok',
      announcements: [],
    });
  });

  it('treats a missing feed (404) as no announcements', async () => {
    const result = await setup(
      vi.fn<typeof fetch>().mockResolvedValue(response('Not Found', { status: 404 })),
    ).check();
    expect(result).toEqual({ status: 'ok', announcements: [] });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', response('{"schema":1,')],
    ['HTML error page', response('<html>oops</html>')],
    ['wrong shape', response('[1,2,3]')],
    ['unknown schema', response('{"schema":99,"announcements":[]}')],
    ['server error', response('', { status: 503 })],
    [
      'oversized by header',
      response('{}', {
        headers: { 'content-length': String(SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES + 1) },
      }),
    ],
    ['oversized body', response(' '.repeat(SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES + 1))],
  ])('returns error for %s without throwing', async (_label, res) => {
    expect(await setup(vi.fn<typeof fetch>().mockResolvedValue(res)).check()).toEqual({
      status: 'error',
    });
  });

  it('sanitizes logged feed errors', async () => {
    await setup(
      vi.fn<typeof fetch>().mockResolvedValue(response('{"schema":"\u001b[31m"}')),
    ).check();
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).not.toContain('\u001b');
  });

  it('keeps valid rows when some rows are bad and logs the skip', async () => {
    const result = await setup(
      vi.fn<typeof fetch>().mockResolvedValue(response(feedText(row, { id: 'BAD' }))),
    ).check();
    expect(result.status === 'ok' && result.announcements).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('skipped 1 invalid row'));
  });

  it('sends If-None-Match and returns the cache on 304', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(feedText(row), { headers: { etag: '"abc"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const fetcher = setup(fetchImpl);
    await fetcher.check();
    const second = await fetcher.check();
    expect(second.status === 'ok' && second.announcements.map((a) => a.id)).toEqual(['maint']);
    const headers = fetchImpl.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(headers['If-None-Match']).toBe('"abc"');
  });

  it('returns error on a 304 with no cache', async () => {
    expect(
      await setup(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 304 })),
      ).check(),
    ).toEqual({ status: 'error' });
  });

  it('keeps known URLs from the last good feed after a failed check', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(feedText(row)))
      .mockResolvedValueOnce(response('garbage'));
    const fetcher = setup(fetchImpl);
    await fetcher.check();
    expect(await fetcher.check()).toEqual({ status: 'error' });
    expect(fetcher.isKnownUrl('https://example.com/notes')).toBe(true);
  });

  it('coalesces concurrent checks into one request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(feedText(row)));
    const fetcher = setup(fetchImpl);
    await Promise.all([fetcher.check(), fetcher.check()]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a gzip body that inflates past the feed cap', async () => {
    const payload = JSON.stringify({
      schema: 1,
      announcements: [row],
      pad: 'A'.repeat(SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES),
    });
    const gzipped = gzipSync(Buffer.from(payload));
    expect(gzipped.byteLength).toBeLessThanOrEqual(SERVICE_ANNOUNCEMENT_MAX_FEED_BYTES);
    const fetcher = setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(gzipped)));
    expect(await fetcher.check()).toEqual({ status: 'error' });
    expect(fetcher.isKnownUrl('https://example.com/notes')).toBe(false);
  });

  it.each([
    ['off-host', 'https://evil.example/announcements.json'],
    [
      'cleartext github host',
      'http://raw.githubusercontent.com/Colorado-Mesh/mesh-client/main/announcements/announcements.json',
    ],
  ])('ignores an %s response', async (_label, finalUrl) => {
    const res = response(feedText(row));
    Object.defineProperty(res, 'url', { value: finalUrl });
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      expect(init?.redirect).toBe('error');
      return Promise.resolve(res);
    });
    const fetcher = setup(fetchImpl);
    expect(await fetcher.check()).toEqual({ status: 'error' });
    expect(fetcher.isKnownUrl('https://example.com/notes')).toBe(false);
    const logged = vi.mocked(console.warn).mock.calls.flat().join(' ');
    expect(logged).not.toContain('evil.example');
  });

  it('accepts a feed whose final URL is https://raw.githubusercontent.com', async () => {
    const res = response(feedText(row));
    Object.defineProperty(res, 'url', { value: SERVICE_ANNOUNCEMENT_FEED_URL });
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      expect(init?.redirect).toBe('error');
      return Promise.resolve(res);
    });
    const result = await setup(fetchImpl).check();
    expect(result.status === 'ok' && result.announcements.map((a) => a.id)).toEqual(['maint']);
  });

  it('treats a redirect rejection as an error and does not throw', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      expect(init?.redirect).toBe('error');
      return Promise.reject(new TypeError('redirect mode is set to error'));
    });
    expect(await setup(fetchImpl).check()).toEqual({ status: 'error' });
  });

  it('never rejects even if the body read throws a non-network error', async () => {
    const res = response(feedText(row));
    vi.spyOn(res, 'arrayBuffer').mockRejectedValue(new Error('boom'));
    expect(await setup(vi.fn<typeof fetch>().mockResolvedValue(res)).check()).toEqual({
      status: 'error',
    });
  });
});

describe('registerServiceAnnouncementIpcHandlers', () => {
  const event = { sender: {} };
  const handle = vi.fn();

  function handler(channel: string) {
    const call = handle.mock.calls.find(([name]) => name === channel) as
      [string, (event: unknown, ...args: unknown[]) => Promise<unknown>] | undefined;
    if (!call) throw new Error(`Missing ${channel}`);
    return call[1];
  }

  beforeEach(() => {
    handle.mockReset();
    vi.mocked(assertIpcSender).mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('asserts the sender on both channels', async () => {
    const fetcher = {
      check: vi.fn(() => Promise.resolve({ status: 'offline' as const })),
      isKnownUrl: vi.fn(() => false),
    };
    registerServiceAnnouncementIpcHandlers({ ipcMain: { handle }, fetcher, openExternal: vi.fn() });
    await handler('serviceAnnouncements:fetch')(event);
    await handler('serviceAnnouncements:open-url')(event, 'https://x.test');
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'serviceAnnouncements:fetch');
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'serviceAnnouncements:open-url');
  });

  it('opens only https URLs that appear in the feed', async () => {
    const openExternal = vi.fn(async () => {});
    const fetcher = {
      check: vi.fn(() => Promise.resolve({ status: 'offline' as const })),
      isKnownUrl: (href: string) => href === 'https://example.com/notes',
    };
    registerServiceAnnouncementIpcHandlers({ ipcMain: { handle }, fetcher, openExternal });
    const open = handler('serviceAnnouncements:open-url');
    expect(await open(event, 'https://evil.test/')).toBe(false);
    expect(await open(event, 'http://example.com/notes')).toBe(false);
    expect(await open(event, 42)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
    expect(await open(event, 'https://example.com/notes')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/notes');
  });

  it('returns false instead of throwing when openExternal fails', async () => {
    const fetcher = { check: vi.fn(), isKnownUrl: () => true };
    registerServiceAnnouncementIpcHandlers({
      ipcMain: { handle },
      fetcher,
      openExternal: vi.fn(() => Promise.reject(new Error('no handler'))),
    });
    expect(await handler('serviceAnnouncements:open-url')(event, 'https://example.com/')).toBe(
      false,
    );
  });
});
