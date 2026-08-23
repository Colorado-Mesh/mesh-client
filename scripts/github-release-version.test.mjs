import { describe, expect, it } from 'vitest';

import { releaseMatchesTag } from './github-release-version.mjs';

const TAG = 'v5.30.0';

describe('releaseMatchesTag', () => {
  it('matches a normal tagged draft', () => {
    expect(releaseMatchesTag({ tag_name: TAG, name: '5.30.0', draft: true }, TAG)).toBe(true);
  });

  it('matches published untagged-* rows by release name', () => {
    expect(
      releaseMatchesTag(
        {
          tag_name: 'untagged-1a7d458feb5a1ac8ddab',
          name: '5.30.0',
          draft: false,
        },
        TAG,
      ),
    ).toBe(true);
  });

  it('rejects unrelated invalid tag + name pairs', () => {
    expect(releaseMatchesTag({ tag_name: 'broken', name: '5.30.0', draft: true }, TAG)).toBe(false);
  });
});
