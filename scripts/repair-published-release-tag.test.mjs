import { describe, expect, it, vi } from 'vitest';

import { listReleasesForTag } from './github-release-api.mjs';
import { repairPublishedReleaseTag } from './repair-published-release-tag.mjs';

const TAG = 'v5.30.0';

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
});
