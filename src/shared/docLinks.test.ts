// @vitest-environment node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import { extractDocLinkTargets, findBrokenDocLinks } from './docLinks';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('extractDocLinkTargets', () => {
  it('extracts GitHub blob and relative docs/*.md links', () => {
    const fixture = `
      href="https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/diagnostics.md"
      [Troubleshooting](docs/troubleshooting.md#section)
      [Broken](docs/missing.md)
    `;
    expect(extractDocLinkTargets(fixture)).toEqual([
      'docs/diagnostics.md',
      'docs/troubleshooting.md',
      'docs/missing.md',
    ]);
  });
});

describe('findBrokenDocLinks', () => {
  it('all mesh-client documentation links resolve to existing repo files', () => {
    const broken = findBrokenDocLinks(repoRoot);
    expect(broken).toEqual([]);
  });
});
