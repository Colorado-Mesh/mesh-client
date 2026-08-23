// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  compareReleaseTags,
  pickLatestPublishedRelease,
  publishedReleaseGitTag,
  semverGt,
} from '@/shared/githubReleaseVersion';

describe('githubReleaseVersion', () => {
  it('recovers vX.Y.Z from release name when tag_name is untagged-*', () => {
    expect(
      publishedReleaseGitTag({
        tag_name: 'untagged-56bb16db7c14eda58971',
        name: '5.27.0',
        draft: false,
        prerelease: false,
      }),
    ).toBe('v5.27.0');
  });

  it('skips drafts and prereleases', () => {
    expect(
      publishedReleaseGitTag({
        tag_name: 'untagged-abc',
        name: '5.30.0',
        draft: true,
        prerelease: false,
      }),
    ).toBeNull();
  });

  it('pickLatestPublishedRelease prefers highest semver with html_url', () => {
    const picked = pickLatestPublishedRelease([
      {
        tag_name: 'v5.29.0',
        name: '5.29.0',
        draft: false,
        html_url: 'https://github.com/Colorado-Mesh/mesh-client/releases/tag/v5.29.0',
      },
      {
        tag_name: 'untagged-deadbeef',
        name: '5.30.0',
        draft: false,
        html_url: 'https://github.com/Colorado-Mesh/mesh-client/releases/tag/untagged-deadbeef',
      },
    ]);
    expect(picked).toEqual({
      tag: 'v5.30.0',
      version: '5.30.0',
      releaseUrl: 'https://github.com/Colorado-Mesh/mesh-client/releases/tag/untagged-deadbeef',
    });
  });

  it('semverGt compares dotted versions', () => {
    expect(semverGt('5.30.0', '5.29.0')).toBe(true);
    expect(semverGt('5.29.0', '5.30.0')).toBe(false);
    expect(compareReleaseTags('v5.30.0', 'v5.29.0')).toBeGreaterThan(0);
  });
});
