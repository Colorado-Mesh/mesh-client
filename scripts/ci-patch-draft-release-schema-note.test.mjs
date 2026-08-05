import { describe, expect, it, vi } from 'vitest';
import {
  mergeSchemaNoteIntoReleaseBody,
  patchDraftReleaseSchemaNote,
  requireDraftReleaseForSchemaPatch,
} from './ci-patch-draft-release-schema-note.mjs';

describe('mergeSchemaNoteIntoReleaseBody', () => {
  it('prepends schema markdown to an empty body', () => {
    const out = mergeSchemaNoteIntoReleaseBody('', '# Schema\n\nbumped\n');
    expect(out).toContain('<!-- mesh-client-schema-compare -->');
    expect(out).toContain('# Schema');
    expect(out).toContain('bumped');
  });

  it('replaces a previous schema block and keeps the rest', () => {
    const existing =
      '<!-- mesh-client-schema-compare -->\nold\n<!-- mesh-client-schema-compare -->\n\nDraft release for v1.0.0.\n';
    const out = mergeSchemaNoteIntoReleaseBody(existing, 'new note');
    expect(out).toContain('new note');
    expect(out).not.toContain('old');
    expect(out).toContain('Draft release for v1.0.0.');
  });
});

describe('requireDraftReleaseForSchemaPatch', () => {
  it('returns the draft release when present', () => {
    const draft = { id: 2, draft: true, body: 'draft' };
    expect(
      requireDraftReleaseForSchemaPatch(
        [{ id: 1, draft: false, body: 'published' }, draft],
        'v1.0.0',
      ),
    ).toBe(draft);
  });

  it('throws when only published releases exist (no published fallback)', () => {
    expect(() =>
      requireDraftReleaseForSchemaPatch([{ id: 1, draft: false, body: 'published' }], 'v1.0.0'),
    ).toThrow('No release found for v1.0.0');
  });
});

describe('patchDraftReleaseSchemaNote', () => {
  it('does not PATCH when list returns only published releases', async () => {
    const patch = vi.fn();
    const ensureDraft = vi.fn().mockResolvedValue({ id: 99, draft: true });
    const listReleases = vi
      .fn()
      .mockResolvedValue([{ id: 1, draft: false, body: 'published release notes' }]);

    await expect(
      patchDraftReleaseSchemaNote({
        tag: 'v1.0.0',
        token: 'token',
        markdown: '# Schema bumped',
        ensureDraft,
        listReleases,
        patch,
      }),
    ).rejects.toThrow('No release found for v1.0.0');

    expect(ensureDraft).toHaveBeenCalled();
    expect(listReleases).toHaveBeenCalledWith('v1.0.0', 'token');
    expect(patch).not.toHaveBeenCalled();
  });

  it('PATCHes the draft body when a draft exists', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 2 });
    await patchDraftReleaseSchemaNote({
      tag: 'v1.0.0',
      token: 'token',
      markdown: '# Schema bumped',
      ensureDraft: vi.fn().mockResolvedValue({ id: 2, draft: true }),
      listReleases: vi.fn().mockResolvedValue([
        { id: 1, draft: false, body: 'published' },
        { id: 2, draft: true, body: 'Draft release for v1.0.0.\n' },
      ]),
      patch,
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]).toBe(2);
    expect(patch.mock.calls[0][2].body).toContain('# Schema bumped');
    expect(patch.mock.calls[0][2].body).toContain('Draft release for v1.0.0.');
  });
});
