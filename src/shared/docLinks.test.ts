// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

import {
  docsSitePageToRepoPath,
  extractDocLinkTargets,
  findBrokenDocLinks,
  GENERATED_SITE_PAGES,
  githubHeadingSlug,
  markdownHeadingAnchors,
} from './docLinks';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function collectMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectMarkdownFiles(full));
    else if (ent.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function mkdocsNavMarkdownTargets(mkdocsYaml: string): string[] {
  const navStart = mkdocsYaml.indexOf('\nnav:');
  if (navStart < 0) return [];
  const navBlock = mkdocsYaml.slice(navStart);
  const matches = [...navBlock.matchAll(/:\s*([A-Za-z0-9_./-]+\.md)\s*$/gm)];
  return matches.flatMap((m) => (m[1] ? [m[1]] : []));
}

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

describe('mkdocs nav completeness', () => {
  it('keeps committed docs pages and nav entries in sync', () => {
    const mkdocsYaml = readFileSync(join(repoRoot, 'mkdocs.yml'), 'utf8');
    const navTargets = mkdocsNavMarkdownTargets(mkdocsYaml);
    expect(navTargets.length).toBeGreaterThan(0);

    const generatedBasenames = new Set([...GENERATED_SITE_PAGES].map((p) => `${p}.md`));
    for (const target of navTargets) {
      if (generatedBasenames.has(target.split('/').pop() ?? '')) continue;
      const abs = join(repoRoot, 'docs', target);
      expect(existsSync(abs), `nav entry has no file: ${target}`).toBe(true);
    }

    const onDisk = collectMarkdownFiles(join(repoRoot, 'docs'))
      .map((abs) => relative(join(repoRoot, 'docs'), abs).replaceAll('\\', '/'))
      .filter((rel) => !generatedBasenames.has(rel.split('/').pop() ?? ''));

    const navSet = new Set(navTargets);
    for (const rel of onDisk) {
      expect(navSet.has(rel), `missing from nav: ${rel}`).toBe(true);
    }
  });
});

describe('new page discoverability', () => {
  it('links each new guide from README.md or docs/index.md', () => {
    const discoverabilitySources = [
      readFileSync(join(repoRoot, 'README.md'), 'utf8'),
      readFileSync(join(repoRoot, 'docs/index.md'), 'utf8'),
    ].join('\n');
    const required = [
      'chat',
      'maps',
      'tak',
      'firmware',
      'meshtastic',
      'meshcore',
      'settings',
      'development/firmware-flash',
      'development/tak',
    ];
    for (const page of required) {
      const patterns = [
        `docs/${page}.md`,
        `(${page}.md`,
        `](${page}.md`,
        `](${page.split('/').pop()}.md`,
      ];
      const found = patterns.some((p) => discoverabilitySources.includes(p));
      expect(found, `page not linked from README or docs/index.md: ${page}`).toBe(true);
    }
  });
});
