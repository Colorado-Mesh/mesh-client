// @vitest-environment node
import { gzipSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

import {
  decodeGithubApiBody,
  fetchAllGithubReleases,
  parseGithubReleasesJson,
} from '@/shared/fetchGithubReleases';
import { pickLatestPublishedRelease } from '@/shared/githubReleaseVersion';

const REPO = 'Colorado-Mesh/mesh-client';
const TEST_PAGE_SIZE = 2;

function releaseRow(version: string) {
  return {
    tag_name: `v${version}`,
    name: version,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/${REPO}/releases/tag/v${version}`,
  };
}

describe('decodeGithubApiBody / parseGithubReleasesJson', () => {
  it('decodes plain UTF-8 JSON', async () => {
    const rows = [releaseRow('1.2.3')];
    const bytes = new TextEncoder().encode(JSON.stringify(rows));
    expect(await decodeGithubApiBody(bytes)).toBe(JSON.stringify(rows));
    expect(await parseGithubReleasesJson(bytes)).toEqual(rows);
  });

  it('gunzips bodies that still have gzip framing (Electron fetch quirk)', async () => {
    const rows = [releaseRow('2.0.0'), releaseRow('2.0.1')];
    const gzipped = gzipSync(Buffer.from(JSON.stringify(rows), 'utf8'));
    expect(gzipped[0]).toBe(0x1f);
    expect(gzipped[1]).toBe(0x8b);

    const decoded = await decodeGithubApiBody(new Uint8Array(gzipped));
    expect(JSON.parse(decoded)).toEqual(rows);
    expect(await parseGithubReleasesJson(new Uint8Array(gzipped))).toEqual(rows);
  });

  it('rejects non-JSON after decode with a clear error', async () => {
    const bytes = new TextEncoder().encode('not-json');
    await expect(parseGithubReleasesJson(bytes)).rejects.toThrow(/non-JSON body/);
  });

  it('rejects non-array JSON payloads', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ tag_name: 'v1.0.0' }));
    await expect(parseGithubReleasesJson(bytes)).rejects.toThrow(/Unexpected GitHub releases/);
  });
});

describe('fetchAllGithubReleases', () => {
  it('paginates until a short page and selects the highest semver across pages', async () => {
    const page1 = [releaseRow('1.0.0'), releaseRow('1.0.1')];
    const page2 = [releaseRow('99.0.0')];

    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('page=1')) {
        return Promise.resolve(Response.json(page1));
      }
      if (url.includes('page=2')) {
        return Promise.resolve(Response.json(page2));
      }
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });

    const releases = await fetchAllGithubReleases(
      REPO,
      'mesh-client-test',
      fetchMock,
      TEST_PAGE_SIZE,
    );
    expect(releases).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const latest = pickLatestPublishedRelease(releases);
    expect(latest?.version).toBe('99.0.0');
  });

  it('requests identity encoding and still parses gzip response bodies', async () => {
    const page = [releaseRow('3.1.0')];
    const gzipped = gzipSync(Buffer.from(JSON.stringify(page), 'utf8'));

    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Accept-Encoding')).toBe('identity');
      expect(headers.get('User-Agent')).toBe('mesh-client-test');
      return Promise.resolve(
        new Response(gzipped, {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        }),
      );
    });

    const releases = await fetchAllGithubReleases(
      REPO,
      'mesh-client-test',
      fetchMock,
      TEST_PAGE_SIZE,
    );
    expect(releases).toEqual(page);
  });

  it('surfaces HTTP errors without attempting JSON parse', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('rate limited', { status: 403 })),
    );
    await expect(fetchAllGithubReleases(REPO, 'mesh-client-test', fetchMock)).rejects.toThrow(
      /responded with 403/,
    );
  });
});
