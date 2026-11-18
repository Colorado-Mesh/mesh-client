import { describe, expect, it, vi } from 'vitest';
import {
  mergeReleaseNotesIntoReleaseBody,
  mergeSchemaNoteIntoReleaseBody,
  patchDraftReleaseSchemaNote,
  requireDraftReleaseForSchemaPatch,
  schemaMarkdownFromCompareOutputs,
} from './ci-patch-draft-release-schema-note.mjs';

const NOTES_MARKER = '<!-- mesh-client-release-notes -->';
const PLACEHOLDER = 'Draft release for v1.1.0. CI is uploading platform artifacts.';
const SCHEMA_BLOCK =
  '<!-- mesh-client-schema-compare -->\n# Schema\n<!-- mesh-client-schema-compare -->';

describe('mergeReleaseNotesIntoReleaseBody', () => {
  it('puts the notes first and drops the draft placeholder', () => {
    const out = mergeReleaseNotesIntoReleaseBody(
      `${SCHEMA_BLOCK}\n\n${PLACEHOLDER}\n`,
      '### Features\n\n- feat: maps (#1)\n',
      'v1.1.0',
    );
    expect(out).toBe(
      `${NOTES_MARKER}\n### Features\n\n- feat: maps (#1)\n${NOTES_MARKER}\n\n${SCHEMA_BLOCK}\n`,
    );
  });

  it('replaces earlier notes instead of stacking them', () => {
    const once = mergeReleaseNotesIntoReleaseBody(`${PLACEHOLDER}\n`, '- first', 'v1.1.0');
    expect(mergeReleaseNotesIntoReleaseBody(once, '- first', 'v1.1.0')).toBe(once);
    const changed = mergeReleaseNotesIntoReleaseBody(once, '- second', 'v1.1.0');
    expect(changed).toBe(`${NOTES_MARKER}\n- second\n${NOTES_MARKER}\n`);
  });

  it('leaves the body alone without usable notes', () => {
    const body = `${SCHEMA_BLOCK}\n\n${PLACEHOLDER}\n`;
    expect(mergeReleaseNotesIntoReleaseBody(body, '', 'v1.1.0')).toBe(body);
    expect(mergeReleaseNotesIntoReleaseBody(body, '  \n', 'v1.1.0')).toBe(body);
    // The emergency release.sh path tags with this one-line message.
    expect(mergeReleaseNotesIntoReleaseBody(body, 'Release v1.1.0\n', 'v1.1.0')).toBe(body);
  });
});

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

  it('writes the annotated tag message above the install and schema notes', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 2 });
    const fetchTagMessage = vi.fn().mockResolvedValue('### Features\n\n- feat: maps (#1)\n');
    await patchDraftReleaseSchemaNote({
      tag: 'v1.1.0',
      token: 'token',
      markdown: '# Schema bumped',
      releaseId: 2,
      getReleaseById: vi.fn().mockResolvedValue({ id: 2, draft: true, body: `${PLACEHOLDER}\n` }),
      fetchTagMessage,
      patch,
    });

    expect(fetchTagMessage).toHaveBeenCalledWith('v1.1.0');
    const body = patch.mock.calls[0][2].body;
    expect(
      body.startsWith(`${NOTES_MARKER}\n### Features\n\n- feat: maps (#1)\n${NOTES_MARKER}`),
    ).toBe(true);
    expect(body.indexOf('### macOS install')).toBeGreaterThan(body.indexOf('feat: maps'));
    expect(body.indexOf('# Schema bumped')).toBeGreaterThan(body.indexOf('feat: maps'));
    expect(body).not.toContain('Draft release for');
  });

  it('keeps the previous body for a lightweight tag', async () => {
    const patch = vi.fn().mockResolvedValue({ id: 2 });
    await patchDraftReleaseSchemaNote({
      tag: 'v1.1.0',
      token: 'token',
      markdown: '# Schema bumped',
      releaseId: 2,
      getReleaseById: vi.fn().mockResolvedValue({ id: 2, draft: true, body: `${PLACEHOLDER}\n` }),
      fetchTagMessage: vi.fn().mockResolvedValue(null),
      patch,
    });

    const body = patch.mock.calls[0][2].body;
    expect(body).toContain(PLACEHOLDER);
    expect(body).not.toContain(NOTES_MARKER);
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
