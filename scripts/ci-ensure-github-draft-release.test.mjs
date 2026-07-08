import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dedupeEmptyDraftReleases,
  ensureGithubDraftRelease,
  listReleasesForTag,
  pickCanonicalRelease,
} from './github-release-api.mjs';

const TAG = 'v5.21.0';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pickCanonicalRelease', () => {
  it('prefers the release with the most assets', () => {
    const keeper = pickCanonicalRelease([
      { id: 1, assets: [{ name: 'a' }], body: '' },
      { id: 2, assets: [{ name: 'a' }, { name: 'b' }], body: '' },
    ]);
    expect(keeper.id).toBe(2);
  });

  it('prefers the release with the longest body when asset counts tie', () => {
    const keeper = pickCanonicalRelease([
      { id: 1, assets: [], body: 'short' },
      { id: 2, assets: [], body: 'much longer release notes body' },
    ]);
    expect(keeper.id).toBe(2);
  });
});

describe('listReleasesForTag', () => {
  it('matches tag_name and draft name fallback', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { id: 1, tag_name: 'v5.20.4', name: '5.20.4', draft: true, assets: [] },
            { id: 2, tag_name: 'v5.21.0', name: '5.21.0', draft: true, assets: [] },
            { id: 3, tag_name: 'untagged-deadbeef', name: '5.21.0', draft: true, assets: [] },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const releases = await listReleasesForTag(TAG, 'token');
    expect(releases.map((release) => release.id)).toEqual([2, 3]);
  });
});

describe('ensureGithubDraftRelease', () => {
  it('deletes empty duplicates and keeps the canonical release', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return new Response(
          JSON.stringify([
            { id: 10, tag_name: TAG, name: '5.21.0', draft: true, assets: [{ name: 'linux.deb' }] },
            { id: 11, tag_name: TAG, name: '5.21.0', draft: true, assets: [] },
          ]),
          { status: 200 },
        );
      }
      if (method === 'DELETE' && href.endsWith('/releases/11')) {
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await ensureGithubDraftRelease({
      tag: TAG,
      token: 'test-token',
      log: () => {},
    });

    expect(release.id).toBe(10);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('creates a draft when no release exists', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (method === 'POST' && href.endsWith('/releases')) {
        return new Response(JSON.stringify({ id: 99, tag_name: TAG, draft: true, assets: [] }), {
          status: 201,
        });
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await ensureGithubDraftRelease({
      tag: TAG,
      token: 'test-token',
      log: () => {},
    });

    expect(release.id).toBe(99);
  });
});

describe('dedupeEmptyDraftReleases', () => {
  it('fails when duplicate releases still have assets', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { id: 1, tag_name: TAG, name: '5.21.0', draft: true, assets: [{ name: 'a' }] },
            { id: 2, tag_name: TAG, name: '5.21.0', draft: true, assets: [{ name: 'b' }] },
          ]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await dedupeEmptyDraftReleases(TAG, 'token', () => {});
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
