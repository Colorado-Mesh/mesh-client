import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchLatestMeshCoreRelease,
  fetchLatestMeshtasticRelease,
  meshCoreFirmwareUpdateAvailable,
  normalizeMeshCoreVersionTag,
  parseMeshCoreBuildDate,
  semverGt,
} from './firmwareCheck';

// ─── semverGt ─────────────────────────────────────────────────────

describe('semverGt', () => {
  it('returns true when remote patch is greater', () => {
    expect(semverGt('1.14.1', '1.14.0')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(semverGt('1.14.0', '1.14.0')).toBe(false);
  });

  it('returns false when remote is less than local', () => {
    expect(semverGt('1.13.0', '1.14.0')).toBe(false);
  });

  it('handles major version bump', () => {
    expect(semverGt('2.0.0', '1.99.99')).toBe(true);
  });

  it('handles minor version bump', () => {
    expect(semverGt('1.15.0', '1.14.99')).toBe(true);
  });

  it('strips v-prefix from remote', () => {
    expect(semverGt('v2.5.4', '2.5.3')).toBe(true);
    expect(semverGt('v2.5.3', '2.5.3')).toBe(false);
  });

  it('strips v-prefix from local', () => {
    expect(semverGt('2.5.4', 'v2.5.3')).toBe(true);
  });

  it('treats malformed string segments as 0', () => {
    expect(semverGt('abc', '1.0.0')).toBe(false);
    expect(semverGt('1.0.0', 'abc')).toBe(true);
  });
});

// ─── fetchLatestMeshtasticRelease ─────────────────────────────────

describe('fetchLatestMeshtasticRelease', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resolves with version (v-prefix stripped) and releaseUrl', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tag_name: 'v2.5.4',
          html_url: 'https://github.com/test/releases/tag/v2.5.4',
        }),
        { status: 200 },
      ),
    );

    const result = await fetchLatestMeshtasticRelease();
    expect(result.version).toBe('2.5.4');
    expect(result.releaseUrl).toBe('https://github.com/test/releases/tag/v2.5.4');
  });

  it('rejects on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    await expect(fetchLatestMeshtasticRelease()).rejects.toThrow('404');
  });

  it('propagates network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network error'));
    await expect(fetchLatestMeshtasticRelease()).rejects.toThrow('network error');
  });

  it('aborts and rejects on timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementationOnce((_url, init) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const promise = fetchLatestMeshtasticRelease();
    void promise.catch(() => {}); // prevent unhandled rejection before assertion runs
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(promise).rejects.toThrow();
    vi.useRealTimers();
  });
});

// ─── fetchLatestMeshCoreRelease ───────────────────────────────────

describe('fetchLatestMeshCoreRelease', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resolves with publishedAt Date, version, and releaseUrl', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tag_name: 'v1.14.1',
          html_url: 'https://github.com/meshcore/releases/tag/v1.14.1',
          published_at: '2025-03-20T10:00:00Z',
        }),
        { status: 200 },
      ),
    );

    const result = await fetchLatestMeshCoreRelease();
    expect(result.version).toBe('1.14.1');
    expect(result.releaseUrl).toBe('https://github.com/meshcore/releases/tag/v1.14.1');
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.publishedAt.toISOString()).toBe('2025-03-20T00:00:00.000Z');
  });

  it('normalizes publishedAt to UTC midnight regardless of publication time', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tag_name: 'vcompanion-v1.14.1',
          html_url: 'https://github.com/meshcore/releases/tag/vcompanion-v1.14.1',
          published_at: '2026-03-20T18:45:00Z',
        }),
        { status: 200 },
      ),
    );

    const result = await fetchLatestMeshCoreRelease();
    // companion-v prefix stripped to semver for display and comparison
    expect(result.version).toBe('1.14.1');
    // published_at time component must be stripped so same-day device firmware
    // ("20 Mar 2026" → 2026-03-20T00:00:00Z) is not falsely flagged as outdated
    expect(result.publishedAt.toISOString()).toBe('2026-03-20T00:00:00.000Z');
  });

  it('rejects on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Server Error', { status: 500 }));
    await expect(fetchLatestMeshCoreRelease()).rejects.toThrow('500');
  });

  it('propagates network failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('network error'));
    await expect(fetchLatestMeshCoreRelease()).rejects.toThrow('network error');
  });
});

// ─── parseMeshCoreBuildDate ───────────────────────────────────────

describe('parseMeshCoreBuildDate', () => {
  it('parses "19 Feb 2025"', () => {
    const d = parseMeshCoreBuildDate('19 Feb 2025');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2025);
    expect(d!.getUTCMonth()).toBe(1); // February
    expect(d!.getUTCDate()).toBe(19);
  });

  it('parses "01 Jan 2024"', () => {
    const d = parseMeshCoreBuildDate('01 Jan 2024');
    expect(d).not.toBeNull();
    expect(d!.getUTCFullYear()).toBe(2024);
    expect(d!.getUTCMonth()).toBe(0); // January
    expect(d!.getUTCDate()).toBe(1);
  });

  it('returns null for empty string', () => {
    expect(parseMeshCoreBuildDate('')).toBeNull();
  });

  it('returns null for unrecognized format', () => {
    expect(parseMeshCoreBuildDate('not a date')).toBeNull();
  });

  it('parses "06-Jun-2026" build date format', () => {
    const d = parseMeshCoreBuildDate('06-Jun-2026');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-06-06T00:00:00.000Z');
  });

  it('returns null for semver firmware strings', () => {
    expect(parseMeshCoreBuildDate('v1.16.0-07a3ca9')).toBeNull();
    expect(parseMeshCoreBuildDate('1.16')).toBeNull();
  });
});

// ─── normalizeMeshCoreVersionTag ──────────────────────────────────

describe('normalizeMeshCoreVersionTag', () => {
  it('extracts semver from companion release tags', () => {
    expect(normalizeMeshCoreVersionTag('companion-v1.16.0')).toBe('1.16.0');
  });

  it('extracts semver from device tags with git suffix', () => {
    expect(normalizeMeshCoreVersionTag('v1.16.0-07a3ca9')).toBe('1.16.0');
  });
});

// ─── meshCoreFirmwareUpdateAvailable ──────────────────────────────

describe('meshCoreFirmwareUpdateAvailable', () => {
  const release = {
    version: 'companion-v1.16.0',
    publishedAt: new Date('2026-06-06T00:00:00.000Z'),
  };

  it('returns false when device semver matches latest release', () => {
    expect(meshCoreFirmwareUpdateAvailable('v1.16.0-07a3ca9', release)).toBe(false);
  });

  it('returns true when release semver is newer', () => {
    expect(meshCoreFirmwareUpdateAvailable('v1.15.0-abc', release)).toBe(true);
  });

  it('uses build date comparison for legacy firmware strings', () => {
    expect(
      meshCoreFirmwareUpdateAvailable('05 Jun 2026', {
        version: 'companion-v1.16.0',
        publishedAt: new Date('2026-06-06T00:00:00.000Z'),
      }),
    ).toBe(true);
    expect(
      meshCoreFirmwareUpdateAvailable('06 Jun 2026', {
        version: 'companion-v1.16.0',
        publishedAt: new Date('2026-06-06T00:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('returns false for unparseable device version (no false positive)', () => {
    expect(
      meshCoreFirmwareUpdateAvailable('not a version', {
        version: 'companion-v1.16.0',
        publishedAt: new Date('2026-06-06T00:00:00.000Z'),
      }),
    ).toBe(false);
  });
});
