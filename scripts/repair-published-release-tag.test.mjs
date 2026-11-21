import { describe, expect, it, vi } from 'vitest';

import { listReleasesForTag } from './github-release-api.mjs';
import {
  repairPublishedReleaseTag,
  resolveRepairReleaseTag,
  resolveRepairTagFromArgv,
} from './repair-published-release-tag.mjs';

const TAG = 'v5.30.0';

describe('resolveRepairReleaseTag', () => {
  it('keeps a semver v* tag', () => {
    expect(resolveRepairReleaseTag(TAG, '5.30.0')).toEqual({ ok: true, tag: TAG });
  });

  it('derives vX.Y.Z from release name when tag_name is untagged-*', () => {
    expect(resolveRepairReleaseTag('untagged-1a7d458feb5a1ac8ddab', '5.30.0')).toEqual({
      ok: true,
      tag: TAG,
      fromUntagged: 'untagged-1a7d458feb5a1ac8ddab',
    });
  });

  it('skips when untagged-* has a non-semver name on release:published', () => {
    expect(
      resolveRepairReleaseTag('untagged-abc', 'nightly', { fromReleasePublished: true }),
    ).toEqual({
      ok: false,
      skip: true,
      message: 'Published release has untagged tag_name and non-semver name=nightly',
    });
    expect(
      resolveRepairReleaseTag('untagged-abc', '6.10.0-beta.1', { fromReleasePublished: true }),
    ).toEqual({
      ok: false,
      skip: true,
      message: 'Published release has untagged tag_name and non-semver name=6.10.0-beta.1',
    });
  });

  it('fails when untagged-* has a non-semver name on manual repair', () => {
    expect(resolveRepairReleaseTag('untagged-abc', 'nightly')).toEqual({
      ok: false,
      message: 'Published release has untagged tag_name and non-semver name=nightly',
    });
  });

  it('skips non-semver tags on release:published only', () => {
    expect(resolveRepairReleaseTag('latest', '5.30.0', { fromReleasePublished: true })).toEqual({
      ok: false,
      skip: true,
      message: 'Skipping non-semver release tag latest',
    });
    expect(resolveRepairReleaseTag('latest', '5.30.0')).toEqual({
      ok: false,
      message: 'Skipping non-semver release tag latest',
    });
  });
});

describe('resolveRepairTagFromArgv', () => {
  it('resolves --from-event via EVENT_TAG / EVENT_NAME', () => {
    expect(
      resolveRepairTagFromArgv(['--from-event'], {
        EVENT_TAG: 'untagged-1a7d458feb5a1ac8ddab',
        EVENT_NAME: '5.30.0',
      }),
    ).toEqual({ ok: true, tag: TAG });
  });

  it('skips --from-event for non-semver tags', () => {
    expect(
      resolveRepairTagFromArgv(['--from-event'], {
        EVENT_TAG: 'latest',
        EVENT_NAME: '',
      }),
    ).toMatchObject({ ok: false, skip: true });
  });
});

describe('listReleasesForTag published untagged', () => {
  it('includes published untagged-* rows that match release name', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([
        { id: 1, tag_name: 'v5.29.0', name: '5.29.0', draft: false, prerelease: false, assets: [] },
        {
          id: 2,
          tag_name: 'untagged-1a7d458feb5a1ac8ddab',
          name: '5.30.0',
          draft: false,
          prerelease: false,
          assets: [],
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const releases = await listReleasesForTag(TAG, 'token');
    expect(releases.map((release) => release.id)).toEqual([2]);
  });
});

describe('repairPublishedReleaseTag', () => {
  it('returns the published release when a draft has the wrong tag and no PATCH is needed', async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return Response.json([
          {
            id: 1,
            tag_name: 'untagged-draft',
            name: '5.30.0',
            draft: true,
            prerelease: false,
            assets: [],
          },
          {
            id: 2,
            tag_name: TAG,
            name: '5.30.0',
            draft: false,
            prerelease: false,
            assets: [],
          },
        ]);
      }
      if (method === 'GET' && href.endsWith('/releases/2')) {
        return Response.json({
          id: 2,
          tag_name: TAG,
          name: '5.30.0',
          draft: false,
          assets: [],
        });
      }
      if (method === 'PATCH') {
        throw new Error(`Unexpected PATCH ${href}`);
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await repairPublishedReleaseTag(TAG, 'token');
    expect(release.id).toBe(2);
    expect(release.tag_name).toBe(TAG);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('repairs after re-fetch when list was correct but GET shows detached tag_name', async () => {
    const placeholder = 'untagged-1a7d458feb5a1ac8ddab';
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return Response.json([
          {
            id: 2,
            tag_name: TAG,
            name: '5.30.0',
            draft: false,
            prerelease: false,
            assets: [],
          },
        ]);
      }
      if (method === 'GET' && href.endsWith('/releases/2')) {
        return Response.json({
          id: 2,
          tag_name: placeholder,
          name: '5.30.0',
          draft: false,
          assets: [],
        });
      }
      if (method === 'PATCH' && href.endsWith('/releases/2')) {
        return Response.json({
          id: 2,
          tag_name: TAG,
          name: '5.30.0',
          draft: false,
          assets: [],
        });
      }
      if (method === 'DELETE' && href.includes(`/git/refs/tags/${placeholder}`)) {
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await repairPublishedReleaseTag(TAG, 'token');
    expect(release.tag_name).toBe(TAG);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
  });

  it('does not PATCH after re-fetch when tag_name is a different valid tag', async () => {
    const otherTag = 'v5.31.0';
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        return Response.json([
          {
            id: 2,
            tag_name: TAG,
            name: '5.30.0',
            draft: false,
            prerelease: false,
            assets: [],
          },
        ]);
      }
      if (method === 'GET' && href.endsWith('/releases/2')) {
        return Response.json({
          id: 2,
          tag_name: otherTag,
          name: '5.31.0',
          draft: false,
          assets: [],
        });
      }
      if (method === 'PATCH') {
        throw new Error(`Unexpected PATCH ${href}`);
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await repairPublishedReleaseTag(TAG, 'token');
    expect(release.tag_name).toBe(otherTag);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('repairs a published untagged release and deletes the orphan ref', async () => {
    let releaseListCalls = 0;
    const placeholder = 'untagged-1a7d458feb5a1ac8ddab';
    const fetchMock = vi.fn(async (url, init) => {
      const method = init?.method ?? 'GET';
      const href = String(url);
      if (method === 'GET' && href.includes('/releases?')) {
        releaseListCalls += 1;
        if (releaseListCalls === 1) {
          return Response.json([
            {
              id: 2,
              tag_name: placeholder,
              name: '5.30.0',
              draft: false,
              prerelease: false,
              assets: [],
            },
          ]);
        }
        return Response.json([
          {
            id: 2,
            tag_name: TAG,
            name: '5.30.0',
            draft: false,
            prerelease: false,
            assets: [],
          },
        ]);
      }
      if (method === 'PATCH' && href.endsWith('/releases/2')) {
        return Response.json({
          id: 2,
          tag_name: TAG,
          name: '5.30.0',
          draft: false,
          assets: [],
        });
      }
      if (method === 'DELETE' && href.includes(`/git/refs/tags/${placeholder}`)) {
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected fetch ${method} ${href}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const release = await repairPublishedReleaseTag(TAG, 'token');
    expect(release.tag_name).toBe(TAG);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          init?.method === 'DELETE' && String(url).includes(`/git/refs/tags/${placeholder}`),
      ),
    ).toBe(true);
  });
});
