import { describe, expect, it } from 'vitest';

import {
  releaseMatchesTag,
  trustedReleaseTag,
  trustedSemverComponent,
} from './github-release-version.mjs';

const TAG = 'v5.30.0';

describe('releaseMatchesTag', () => {
  it('matches a normal tagged draft', () => {
    expect(
      releaseMatchesTag({ tag_name: TAG, name: '5.30.0', draft: true, prerelease: false }, TAG),
    ).toBe(true);
  });

  it('matches published untagged-* rows by release name', () => {
    expect(
      releaseMatchesTag(
        {
          tag_name: 'untagged-1a7d458feb5a1ac8ddab',
          name: '5.30.0',
          draft: false,
          prerelease: false,
        },
        TAG,
      ),
    ).toBe(true);
  });

  it('rejects unrelated invalid tag + name pairs', () => {
    expect(
      releaseMatchesTag(
        { tag_name: 'broken', name: '5.30.0', draft: true, prerelease: false },
        TAG,
      ),
    ).toBe(false);
  });
});

describe('trustedReleaseTag', () => {
  it('normalizes leading-zero components', () => {
    expect(trustedReleaseTag('v01.02.03')).toBe('v1.2.3');
    expect(trustedSemverComponent('0005')).toBe(5);
  });

  it('rejects semver components outside Number.MAX_SAFE_INTEGER', () => {
    const unsafe = String(Number.MAX_SAFE_INTEGER + 1);
    expect(() => trustedSemverComponent(unsafe)).toThrow(/Unsafe release tag component/);
    expect(() => trustedReleaseTag(`v${unsafe}.0.0`)).toThrow(/Unsafe release tag/);
  });
});
