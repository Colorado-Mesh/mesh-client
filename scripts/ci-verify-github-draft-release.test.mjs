import { describe, expect, it } from 'vitest';

import {
  verifyDraftReleaseTag,
  verifyNoUntaggedMatchingReleases,
} from './ci-verify-github-draft-release.mjs';

describe('verifyDraftReleaseTag', () => {
  it('passes when draft tag_name matches expected tag', () => {
    expect(verifyDraftReleaseTag({ tag_name: 'v5.30.0', draft: true }, 'v5.30.0')).toEqual({
      ok: true,
      message: 'Draft release tag_name is v5.30.0',
    });
  });

  it('fails when draft still has untagged-* tag_name', () => {
    const result = verifyDraftReleaseTag({ tag_name: 'untagged-deadbeef', draft: true }, 'v5.30.0');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Do NOT publish');
  });

  it('fails when release is already published', () => {
    const result = verifyDraftReleaseTag(
      { tag_name: 'untagged-deadbeef', draft: false },
      'v5.30.0',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not a draft');
  });
});

describe('verifyNoUntaggedMatchingReleases', () => {
  it('passes when every matching release uses the expected tag', () => {
    expect(
      verifyNoUntaggedMatchingReleases([{ id: 1, tag_name: 'v5.30.0', draft: true }], 'v5.30.0'),
    ).toEqual({
      ok: true,
      message: 'No untagged-* releases match v5.30.0',
    });
  });

  it('fails when a matching release is still on untagged-*', () => {
    const result = verifyNoUntaggedMatchingReleases(
      [
        { id: 1, tag_name: 'v5.30.0', draft: true },
        { id: 2, tag_name: 'untagged-deadbeef', draft: true },
      ],
      'v5.30.0',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('untagged-deadbeef');
    expect(result.message).toContain('Do NOT publish');
  });
});
