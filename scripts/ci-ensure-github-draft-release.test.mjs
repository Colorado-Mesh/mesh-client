import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSafeReleaseTag,
  consolidateReleases,
  ensureGithubDraftRelease,
  listReleasesForTag,
  normalizeDraftReleasesForTag,
  pickCanonicalRelease,
  resolveTag,
  waitForGithubDraftRelease,
} from './github-release-api.mjs';

const TAG = 'v5.21.0';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('assertSafeReleaseTag', () => {
  it('accepts v-prefixed semver tags', () => {
    expect(assertSafeReleaseTag('v5.21.0')).toBe('v5.21.0');
  });

  it('rejects malformed tags', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    assertSafeReleaseTag('v5.21.0-evil/../../../etc/passwd');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

describe('resolveTag', () => {
  it('uses RELEASE_TAG when set', () => {
    const tag = resolveTag([], { RELEASE_TAG: 'v5.21.0' });
    expect(tag).toBe('v5.21.0');
  });

  it('uses refs/tags ref on tag push', () => {
    const tag = resolveTag([], { GITHUB_REF: 'refs/tags/v5.21.0' });
    expect(tag).toBe('v5.21.0');
  });
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
      if (method === 'PATCH' && href.endsWith('/releases/10')) {
        return new Response(
          JSON.stringify({
            id: 10,
            tag_name: TAG,
            name: '5.21.0',
            draft: true,
            assets: [{ name: 'linux.deb' }],
          }),
          { status: 200 },
        );
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

  it('creates a draft when no release exists and allowCreate is true', async () => {
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
      allowCreate: true,
      log: () => {},
    });

    expect(release.id).toBe(99);
  });

  it('creates a draft when only a published release matches and allowCreate is true', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return new Response(
          JSON.stringify([{ id: 1, tag_name: TAG, name: '5.21.0', draft: false, assets: [] }]),
          { status: 200 },
        );
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
      allowCreate: true,
      log: () => {},
    });

    expect(release.id).toBe(99);
    expect(release.draft).toBe(true);
  });

  it('does not create when allowCreate is false and no draft exists', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await ensureGithubDraftRelease({
      tag: TAG,
      token: 'test-token',
      allowCreate: false,
      log: () => {},
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchMock.mock.calls.some(([, init]) => (init?.method ?? 'GET') === 'POST')).toBe(false);
    exitSpy.mockRestore();
  });
});

describe('normalizeDraftReleasesForTag', () => {
  it('merges duplicate releases that still hold assets', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              tag_name: TAG,
              name: '5.21.0',
              draft: true,
              assets: [
                { id: 101, name: 'a' },
                { id: 103, name: 'c' },
              ],
            },
            {
              id: 2,
              tag_name: 'untagged-deadbeef',
              name: '5.21.0',
              draft: true,
              assets: [{ id: 102, name: 'b' }],
            },
          ]),
          { status: 200 },
        );
      }
      if (method === 'GET' && href.endsWith('/releases/assets/102')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (method === 'POST' && href.includes('/releases/1/assets')) {
        return new Response(JSON.stringify({ id: 999, name: 'b' }), { status: 201 });
      }
      if (
        method === 'DELETE' &&
        (href.endsWith('/releases/assets/102') || href.endsWith('/releases/2'))
      ) {
        return new Response('', { status: 200 });
      }
      if (method === 'PATCH' && href.endsWith('/releases/1')) {
        return new Response(
          JSON.stringify({
            id: 1,
            tag_name: TAG,
            name: '5.21.0',
            draft: true,
            assets: [{ name: 'a' }, { name: 'b' }],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await normalizeDraftReleasesForTag(TAG, 'token', { log: () => {} });
    expect(release.id).toBe(1);
    expect(release.tag_name).toBe(TAG);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/releases/2'),
      ),
    ).toBe(true);
  });

  it('repairs untagged draft metadata when only one release exists', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return new Response(
          JSON.stringify([
            {
              id: 3,
              tag_name: 'untagged-deadbeef',
              name: '5.21.0',
              draft: true,
              assets: [],
            },
          ]),
          { status: 200 },
        );
      }
      if (method === 'PATCH' && href.endsWith('/releases/3')) {
        return new Response(
          JSON.stringify({ id: 3, tag_name: TAG, name: '5.21.0', draft: true, assets: [] }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await normalizeDraftReleasesForTag(TAG, 'token', { log: () => {} });
    expect(release.tag_name).toBe(TAG);
  });
});

describe('waitForGithubDraftRelease', () => {
  it('returns the draft after a list miss then hit', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ id: 7, tag_name: TAG, name: '5.21.0', draft: true, assets: [] }]),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const release = await waitForGithubDraftRelease({
      tag: TAG,
      token: 'token',
      attempts: 3,
      delayMs: 1,
      sleep: async () => {},
      log: () => {},
    });

    expect(release.id).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('consolidateReleases', () => {
  it('is a no-op when only one release exists', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([{ id: 1, tag_name: TAG, name: '5.21.0', draft: true, assets: [] }]),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const release = await consolidateReleases({ tag: TAG, token: 'token', log: () => {} });
    expect(release.id).toBe(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('treats metadata PATCH 403 as non-fatal after assets are merged', async () => {
    const logs = [];
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              tag_name: TAG,
              name: '5.21.0',
              draft: true,
              body: '',
              assets: [
                { id: 101, name: 'a' },
                { id: 103, name: 'c' },
              ],
            },
            {
              id: 2,
              tag_name: TAG,
              name: '5.21.0',
              draft: true,
              body: 'longer body from duplicate',
              assets: [{ id: 102, name: 'b' }],
            },
          ]),
          { status: 200 },
        );
      }
      if (method === 'GET' && href.endsWith('/releases/assets/102')) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (method === 'POST' && href.includes('/releases/1/assets')) {
        return new Response(JSON.stringify({ id: 999, name: 'b' }), { status: 201 });
      }
      if (
        method === 'DELETE' &&
        (href.endsWith('/releases/assets/102') || href.endsWith('/releases/2'))
      ) {
        return new Response('', { status: 200 });
      }
      if (method === 'PATCH' && href.endsWith('/releases/1')) {
        return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
          status: 403,
        });
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await consolidateReleases({
      tag: TAG,
      token: 'token',
      targetCommitish: 'a'.repeat(40),
      log: (message) => logs.push(message),
    });

    expect(release.id).toBe(1);
    expect(logs.some((line) => line.includes('PATCH release 1 failed (403)'))).toBe(true);
    const patchBody = JSON.parse(
      fetchMock.mock.calls.find(
        ([url, init]) => init?.method === 'PATCH' && String(url).endsWith('/releases/1'),
      )?.[1]?.body ?? '{}',
    );
    expect(patchBody.target_commitish).toBeUndefined();
  });
});
