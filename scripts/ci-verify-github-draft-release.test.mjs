import { describe, expect, it } from 'vitest';

import { verifyDraftReleaseTag } from './ci-verify-github-draft-release.mjs';

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
