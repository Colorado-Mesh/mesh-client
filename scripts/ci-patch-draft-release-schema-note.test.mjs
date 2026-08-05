import { describe, expect, it } from 'vitest';
import { mergeSchemaNoteIntoReleaseBody } from './ci-patch-draft-release-schema-note.mjs';

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
