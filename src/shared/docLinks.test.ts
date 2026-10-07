// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  docsSitePageToRepoPath,
  extractDocLinkTargets,
  findBrokenDocLinks,
  githubHeadingSlug,
  markdownHeadingAnchors,
} from './docLinks';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('extractDocLinkTargets', () => {
  it('extracts GitHub blob, docs-site, and relative docs/*.md links in source order', () => {
    const fixture = `
      href="https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/diagnostics.md"
      [Troubleshooting](docs/troubleshooting.md#section)
      https://colorado-mesh.github.io/mesh-client/troubleshooting-meshcore/
      [Broken](docs/missing.md)
      https://colorado-mesh.github.io/mesh-client/
    `;
    expect(extractDocLinkTargets(fixture)).toEqual([
      'docs/diagnostics.md',
      'docs/troubleshooting.md',
      'docs/troubleshooting-meshcore.md',
      'docs/missing.md',
      'docs/index.md',
    ]);
  });
});

describe('docsSitePageToRepoPath', () => {
  it('maps site page slugs to docs sources', () => {
    expect(docsSitePageToRepoPath('')).toBe('docs/index.md');
    expect(docsSitePageToRepoPath('diagnostics')).toBe('docs/diagnostics.md');
  });
});

describe('githubHeadingSlug / markdownHeadingAnchors', () => {
  it('matches GitHub slugs, including doubled hyphens and duplicate suffixes', () => {
    expect(
      githubHeadingSlug('macOS: Library not loaded: Squirrel.framework after ZIP extract'),
    ).toBe('macos-library-not-loaded-squirrelframework-after-zip-extract');
    expect(githubHeadingSlug('Map tab without internet (offline / no WAN)')).toBe(
      'map-tab-without-internet-offline--no-wan',
    );
    const anchors = markdownHeadingAnchors('# A\n\n```\n# not a heading\n```\n\n## A\n');
    expect([...anchors]).toEqual(['a', 'a-1']);
  });
});

describe('findBrokenDocLinks', () => {
  it('flags docs-site links whose page or anchor does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'mesh-doclinks-'));
    try {
      mkdirSync(join(root, 'docs'));
      mkdirSync(join(root, 'src/main'), { recursive: true });
      writeFileSync(
        join(root, 'docs/troubleshooting.md'),
        '# Troubleshooting\n\n## Real heading\n',
      );
      writeFileSync(
        join(root, 'src/main/links.ts'),
        [
          "'https://colorado-mesh.github.io/mesh-client/troubleshooting/#real-heading'",
          "'https://colorado-mesh.github.io/mesh-client/troubleshooting/#gone'",
          "'https://colorado-mesh.github.io/mesh-client/nope/'",
          "'https://colorado-mesh.github.io/mesh-client/install/'",
        ].join('\n'),
      );
      expect(findBrokenDocLinks(root).map((b) => b.resolvedPath)).toEqual([
        'docs/troubleshooting.md#gone',
        'docs/nope.md',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('all mesh-client documentation links resolve to existing repo files', () => {
    const broken = findBrokenDocLinks(repoRoot);
    expect(broken).toEqual([]);
  });
});
