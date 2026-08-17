import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadToFile,
  githubApiHeaders,
  normalizeArch,
  normalizeOs,
  pickActionlintAsset,
  PINNED_ACTIONLINT_VERSION,
  pinnedActionlintAsset,
} from './install-actionlint.mjs';

const tempDirs = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
  vi.restoreAllMocks();
});

async function makeTempDir(prefix) {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('install-actionlint', () => {
  it('pins a concrete actionlint version for API rate-limit fallback', () => {
    expect(PINNED_ACTIONLINT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('builds githubApiHeaders with Bearer token when GITHUB_TOKEN is set', () => {
    const headers = githubApiHeaders({ GITHUB_TOKEN: ' ghp_test ' });
    expect(headers.Authorization).toBe('Bearer ghp_test');
    expect(headers['User-Agent']).toBe('mesh-client');
  });

  it('omits Authorization when no token is present', () => {
    const headers = githubApiHeaders({});
    expect(headers.Authorization).toBeUndefined();
  });

  it('normalizes platform/arch keys used in release asset names', () => {
    expect(normalizeOs('linux')).toBe('linux');
    expect(normalizeOs('darwin')).toBe('darwin');
    expect(normalizeOs('win32')).toBe('windows');
    expect(normalizeArch('x64')).toBe('amd64');
    expect(normalizeArch('arm64')).toBe('arm64');
  });

  it('constructs pinned download URLs without calling the Releases API', () => {
    const asset = pinnedActionlintAsset('linux', 'amd64');
    expect(asset.name).toBe(`actionlint_${PINNED_ACTIONLINT_VERSION}_linux_amd64.tar.gz`);
    expect(asset.browser_download_url).toBe(
      `https://github.com/rhysd/actionlint/releases/download/v${PINNED_ACTIONLINT_VERSION}/${asset.name}`,
    );
  });

  it('picks the matching asset from a releases/latest payload', () => {
    const asset = pickActionlintAsset(
      [
        {
          name: `actionlint_${PINNED_ACTIONLINT_VERSION}_linux_amd64.tar.gz`,
          browser_download_url: 'https://example.test/linux.tar.gz',
        },
        {
          name: `actionlint_${PINNED_ACTIONLINT_VERSION}_darwin_arm64.tar.gz`,
          browser_download_url: 'https://example.test/darwin.tar.gz',
        },
      ],
      'darwin',
      'arm64',
    );
    expect(asset).toEqual({
      name: `actionlint_${PINNED_ACTIONLINT_VERSION}_darwin_arm64.tar.gz`,
      browser_download_url: 'https://example.test/darwin.tar.gz',
    });
  });

  it('downloadToFile retries transient fetch failures then succeeds', async () => {
    const dir = await makeTempDir('actionlint-dl-');
    const dest = join(dir, 'asset.bin');
    const sleeps = [];
    const warns = [];
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 3) {
        throw new TypeError('fetch failed');
      }
      return {
        ok: true,
        body: Readable.toWeb(Readable.from([Buffer.from('ok-bytes')])),
      };
    });

    await downloadToFile(
      'https://example.test/asset.bin',
      dest,
      { 'User-Agent': 'test' },
      {
        attempts: 5,
        baseDelayMs: 10,
        fetchImpl,
        sleepImpl: async (ms) => {
          sleeps.push(ms);
        },
        warn: (...args) => warns.push(args.join(' ')),
      },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 20]);
    expect(warns.some((line) => line.includes('fetch failed'))).toBe(true);
    expect(await fs.readFile(dest, 'utf8')).toBe('ok-bytes');
  });

  it('downloadToFile exhausts retries on persistent failure', async () => {
    const dir = await makeTempDir('actionlint-dl-fail-');
    const dest = join(dir, 'asset.bin');
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(
      downloadToFile(
        'https://example.test/asset.bin',
        dest,
        { 'User-Agent': 'test' },
        {
          attempts: 3,
          baseDelayMs: 1,
          fetchImpl,
          sleepImpl: async () => {},
          warn: () => {},
        },
      ),
    ).rejects.toThrow(/fetch failed/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await expect(fs.access(dest)).rejects.toThrow();
  });

  it('downloadToFile retries non-OK HTTP responses', async () => {
    const dir = await makeTempDir('actionlint-dl-http-');
    const dest = join(dir, 'asset.bin');
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 502, statusText: 'Bad Gateway', body: null };
      }
      return {
        ok: true,
        body: Readable.toWeb(Readable.from([Buffer.from('recovered')])),
      };
    });

    await downloadToFile(
      'https://example.test/asset.bin',
      dest,
      {},
      {
        attempts: 3,
        baseDelayMs: 1,
        fetchImpl,
        sleepImpl: async () => {},
        warn: () => {},
      },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await fs.readFile(dest, 'utf8')).toBe('recovered');
  });
});
