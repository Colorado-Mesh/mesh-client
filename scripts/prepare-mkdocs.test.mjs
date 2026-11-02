import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildFeaturesPage,
  buildInstallPage,
  extractMarkedSection,
  githubSlug,
  prepareMkdocs,
  promoteHeadings,
  REPO_BLOB_BASE,
  rewriteRootLinksForSite,
} from './prepare-mkdocs.mjs';

const README = `# Mesh-Client

## Key Features

<!-- docs-site:features:start -->

See [diagnostics](docs/diagnostics.md) and [why](#why).

### Meshtastic Features

- [Below](#meshtastic-features) and [BLE](docs/development/ble-serial.md#x)

<!-- docs-site:features:end -->

## Limitations

<!-- docs-site:limitations:start -->

- Only one radio.

<!-- docs-site:limitations:end -->

## Quick Start

<!-- docs-site:install:start -->

### System requirements

Download from Releases. See [CONTRIBUTING](CONTRIBUTING.md#setup) and [arch](ARCHITECTURE.md).

\`\`\`bash
### not a heading
\`\`\`

<!-- docs-site:install:end -->
`;

describe('prepare-mkdocs helpers', () => {
  it('builds GitHub-compatible slugs', () => {
    expect(githubSlug('Map tab without internet (offline / no WAN)')).toBe(
      'map-tab-without-internet-offline--no-wan',
    );
  });

  it('strips HTML tags from slugs, including nested tags', () => {
    expect(githubSlug('Install <img src="x.png"> now')).toBe('install--now');
    expect(githubSlug('Safe <scr<script>ipt>alert</script> heading')).toBe('safe-alert-heading');
  });

  it('extracts marked sections and rejects missing markers', () => {
    expect(extractMarkedSection(README, 'limitations')).toBe('- Only one radio.');
    expect(() => extractMarkedSection(README, 'nope')).toThrow(/docs-site:nope/);
  });

  it('promotes headings outside code fences only', () => {
    expect(promoteHeadings('### A\n```\n### B\n```\n#### C')).toBe('## A\n```\n### B\n```\n### C');
  });

  it('rewrites root-relative links for the docs site', () => {
    const out = rewriteRootLinksForSite(
      '[a](docs/x.md#h) [b](README.md) [c](#here) [d](#gone) [e](https://x.org) <img src="docs/images/a.png">',
      { sourceFile: 'README.md', pageAnchors: new Set(['here']) },
    );
    expect(out).toBe(
      `[a](x.md#h) [b](${REPO_BLOB_BASE}README.md) [c](#here) [d](${REPO_BLOB_BASE}README.md#gone) [e](https://x.org) <img src="images/a.png">`,
    );
  });
});

describe('generated pages', () => {
  it('builds the install page with promoted headings and site links', () => {
    const page = buildInstallPage(README);
    expect(page).toContain('# Install');
    expect(page).toContain('## System requirements');
    expect(page).toContain('### not a heading');
    expect(page).toContain('[CONTRIBUTING](contributing.md#setup)');
    expect(page).toContain(`[arch](${REPO_BLOB_BASE}ARCHITECTURE.md)`);
    expect(page).toContain('[Development Guide](development-environment.md)');
  });

  it('builds the features page with limitations and keeps in-page anchors', () => {
    const page = buildFeaturesPage(README);
    expect(page).toContain('## Meshtastic Features');
    expect(page).toContain('[Below](#meshtastic-features)');
    expect(page).toContain(`[why](${REPO_BLOB_BASE}README.md#why)`);
    expect(page).toContain('[BLE](development/ble-serial.md#x)');
    expect(page).toContain('[diagnostics](diagnostics.md)');
    expect(page).toContain('## Limitations\n\n- Only one radio.');
  });

  it('writes contributing, install, and features into docs/', () => {
    const root = mkdtempSync(join(tmpdir(), 'mesh-prepare-mkdocs-'));
    try {
      mkdirSync(join(root, 'docs'));
      writeFileSync(join(root, 'README.md'), README);
      writeFileSync(join(root, 'CONTRIBUTING.md'), '# Contributing\n\nSee [dev](docs/dev.md).\n');
      expect(prepareMkdocs(root)).toEqual([
        'docs/contributing.md',
        'docs/install.md',
        'docs/features.md',
      ]);
      expect(readFileSync(join(root, 'docs/contributing.md'), 'utf8')).toContain('[dev](dev.md)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('README features catalogue links', () => {
  it('gives every features ### subsection at least one docs/*.md link', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const start = readme.indexOf('<!-- docs-site:features:start -->');
    const end = readme.indexOf('<!-- docs-site:features:end -->');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = readme.slice(start, end);
    const sections = block.split(/^### /m).slice(1);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      const heading = section.split('\n', 1)[0]?.trim() ?? '(unknown)';
      expect(
        /\]\(docs\/[^)]+\.md/.test(section),
        `features subsection missing docs link: ${heading}`,
      ).toBe(true);
    }
  });
});
