import { describe, expect, it, vi } from 'vitest';

import { listReleasesForTag } from './github-release-api.mjs';

const TAG = 'v5.30.0';

describe('listReleasesForTag published untagged', () => {
  it('includes published untagged-* rows that match release name', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json([
        { id: 1, tag_name: 'v5.29.0', name: '5.29.0', draft: false, assets: [] },
        {
          id: 2,
          tag_name: 'untagged-1a7d458feb5a1ac8ddab',
          name: '5.30.0',
          draft: false,
          assets: [],
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const releases = await listReleasesForTag(TAG, 'token');
    expect(releases.map((release) => release.id)).toEqual([2]);
  });
});
