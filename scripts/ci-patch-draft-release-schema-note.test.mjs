import { describe, expect, it, vi } from 'vitest';
import {
  mergeSchemaNoteIntoReleaseBody,
  patchDraftReleaseSchemaNote,
  requireDraftReleaseForSchemaPatch,
  schemaMarkdownFromCompareOutputs,
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

describe('schemaMarkdownFromCompareOutputs', () => {
  it('rebuilds release markdown from trusted schema outputs', () => {
    const md = schemaMarkdownFromCompareOutputs({
      MESH_CLIENT_SCHEMA_CURR: '49',
      MESH_CLIENT_SCHEMA_PREV: '48',
      MESH_CLIENT_SCHEMA_PREV_TAG: 'v5.26.0',
    });
    expect(md).toContain('Release build — database schema check');
    expect(md).toContain('49');
    expect(md).toContain('v5.26.0');
    expect(md).toContain('48 → 49');
  });

  it('rejects unsafe tags', () => {
    expect(() =>
      schemaMarkdownFromCompareOutputs({
        MESH_CLIENT_SCHEMA_CURR: '49',
        MESH_CLIENT_SCHEMA_PREV: '48',
        MESH_CLIENT_SCHEMA_PREV_TAG: 'evil;rm',
      }),
    ).toThrow(/Unsafe release tag/);
  });
});

describe('patchDraftReleaseSchemaNote', () => {
  it('does not PATCH when ensure returns a published release and list has no draft', async () => {
    const patch = vi.fn();
    const ensureDraft = vi.fn().mockResolvedValue({ id: 1, draft: false, body: 'published' });
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

  it('PATCHes using RELEASE_ID without ensure or list', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 2 });
    const ensureDraft = vi.fn();
    const listReleases = vi.fn();
    await patchDraftReleaseSchemaNote({
      tag: 'v1.0.0',
      token: 'token',
      markdown: '# Schema bumped',
      releaseId: 2,
      ensureDraft,
      listReleases,
      getReleaseById: vi.fn().mockResolvedValue({
        id: 2,
        draft: true,
        body: 'Draft release for v1.0.0.\n',
      }),
      patch,
    });

    expect(ensureDraft).not.toHaveBeenCalled();
    expect(listReleases).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]).toBe(2);
    expect(patch.mock.calls[0][2].body).toContain('# Schema bumped');
    expect(patch.mock.calls[0][2].body).toContain('Draft release for v1.0.0.');
    expect(patch.mock.calls[0][2].body).toContain('### macOS install');
    expect(patch.mock.calls[0][2].body).toContain('7-Zip');
  });

  it('rejects RELEASE_ID when the release is published', async () => {
    const patch = vi.fn();
    await expect(
      patchDraftReleaseSchemaNote({
        tag: 'v1.0.0',
        token: 'token',
        markdown: '# Schema bumped',
        releaseId: 2,
        ensureDraft: vi.fn(),
        listReleases: vi.fn(),
        getReleaseById: vi.fn().mockResolvedValue({
          id: 2,
          draft: false,
          body: 'published',
        }),
        patch,
      }),
    ).rejects.toThrow('Release 2 for v1.0.0 is not a draft');
    expect(patch).not.toHaveBeenCalled();
  });

  it('falls back to list when ensure returns a non-draft', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 2 });
    await patchDraftReleaseSchemaNote({
      tag: 'v1.0.0',
      token: 'token',
      markdown: '# Schema bumped',
      ensureDraft: vi.fn().mockResolvedValue({ id: 1, draft: false, body: 'published' }),
      listReleases: vi.fn().mockResolvedValue([
        { id: 1, draft: false, body: 'published' },
        { id: 2, draft: true, body: 'Draft release for v1.0.0.\n' },
      ]),
      patch,
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][0]).toBe(2);
  });
});
