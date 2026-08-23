// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { fetchAllGithubReleases } from '@/shared/fetchGithubReleases';
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
});
