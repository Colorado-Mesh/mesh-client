// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RUST_SECTION_UNAVAILABLE_NOTE,
  buildRustSidecarSection,
  buildThirdPartyLicensesMarkdown,
  generateThirdPartyLicenses,
  loadRustSidecarSection,
  rsstackRepoUrl,
} from './generate-third-party-licenses.mjs';

const RUST_METADATA = {
  packages: [
    {
      name: 'rns-wire',
      version: '0.1.0',
      license: 'AGPL-3.0-or-later',
      manifest_path: '/repo/.rsstack/rsReticulum/crates/rns-wire/Cargo.toml',
    },
    {
      name: 'lrgp',
      version: '0.2.0',
      license: 'MIT',
      manifest_path: '/repo/.rsstack/lrgp-rs/Cargo.toml',
    },
    {
      name: 'serde',
      version: '1.0.0',
      license: 'MIT OR Apache-2.0',
      manifest_path: '/home/u/.cargo/registry/src/serde-1.0.0/Cargo.toml',
    },
    {
      name: 'serde_json',
      version: '1.0.0',
      license: 'MIT OR Apache-2.0',
      manifest_path: '/home/u/.cargo/registry/src/serde_json-1.0.0/Cargo.toml',
    },
  ],
};

describe('buildThirdPartyLicensesMarkdown', () => {
  it('wraps prod and dev tables with a generated-file header', () => {
    const markdown = buildThirdPartyLicensesMarkdown({
      prodTable: '| name | license type |\n| --- | --- |\n| react | MIT |\n',
      devTable: '| name | license type |\n| --- | --- |\n| vitest | MIT |\n',
    });
    expect(markdown).toMatch(/^# Third-party licenses\n/);
    expect(markdown).toMatch(/Do not edit by hand/);
    expect(markdown).toMatch(/## Runtime dependencies/);
    expect(markdown).toMatch(/## Development dependencies/);
    expect(markdown).toMatch(/credits\.md/);
    expect(markdown).toMatch(/\| react \| MIT \|/);
    expect(markdown).toMatch(/\| vitest \| MIT \|/);
    expect(markdown).toMatch(/check:rust-licenses/);
  });

  it('emits the unavailable note when there is no Rust section', () => {
    const markdown = buildThirdPartyLicensesMarkdown({ prodTable: '| a |', devTable: '| b |' });
    expect(markdown).toMatch(/## Rust sidecar dependencies\n\n/);
    expect(markdown).toContain(RUST_SECTION_UNAVAILABLE_NOTE);
  });

  it('places the Rust section after development dependencies', () => {
    const markdown = buildThirdPartyLicensesMarkdown({
      prodTable: '| a |',
      devTable: '| b |',
      rustSection: 'RUST-BODY',
    });
    expect(markdown.indexOf('## Development dependencies')).toBeLessThan(
      markdown.indexOf('## Rust sidecar dependencies'),
    );
    expect(markdown).toMatch(/## Rust sidecar dependencies\n\nRUST-BODY\n$/);
    expect(markdown).not.toContain(RUST_SECTION_UNAVAILABLE_NOTE);
  });
});

describe('rsstackRepoUrl', () => {
  it('maps .rsstack checkouts to ratspeak GitHub repos', () => {
    expect(rsstackRepoUrl('/r/.rsstack/rsLXMF/crates/lxmf-core/Cargo.toml')).toBe(
      'https://github.com/ratspeak/rsLXMF',
    );
    expect(rsstackRepoUrl('C:\\r\\.rsstack\\rsNomad\\crates\\nomad-core\\Cargo.toml')).toBe(
      'https://github.com/ratspeak/rsNomad',
    );
  });

  it('returns null for registry crates', () => {
    expect(rsstackRepoUrl('/home/u/.cargo/registry/src/serde/Cargo.toml')).toBeNull();
  });
});

describe('buildRustSidecarSection', () => {
  it('renders a license summary and the stack crate table', () => {
    const section = loadRustSidecarSection({
      cargoAvailable: () => true,
      loadMetadata: () => RUST_METADATA,
    });
    expect(section).toMatch(/all 4 crates resolved by `reticulum-sidecar\/Cargo\.lock`/);
    expect(section).toMatch(/\| MIT OR Apache-2\.0 \| 2 \|/);
    expect(section).toMatch(/\| AGPL-3\.0-or-later \| 1 \|/);
    expect(section).toMatch(
      /\| rns-wire \| 0\.1\.0 \| AGPL-3\.0-or-later \| \[rsReticulum\]\(https:\/\/github\.com\/ratspeak\/rsReticulum\) \|/,
    );
    expect(section).toMatch(/\| lrgp \| 0\.2\.0 \| MIT \| \[lrgp-rs\]/);
    expect(section).not.toMatch(/\| serde \|/);
  });

  it('sorts the summary by count descending', () => {
    const section = buildRustSidecarSection([
      { name: 'a', version: '1', license: 'ISC', manifestPath: '' },
      { name: 'b', version: '1', license: 'MIT', manifestPath: '' },
      { name: 'c', version: '1', license: 'MIT', manifestPath: '' },
    ]);
    expect(section.indexOf('| MIT | 2 |')).toBeLessThan(section.indexOf('| ISC | 1 |'));
  });
});

describe('loadRustSidecarSection', () => {
  it('returns null when cargo is unavailable', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(
        loadRustSidecarSection({ cargoAvailable: () => false, loadMetadata: () => RUST_METADATA }),
      ).toBeNull();
      expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/cargo unavailable/));
    } finally {
      stderr.mockRestore();
    }
  });

  it('returns null when cargo metadata fails', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(
        loadRustSidecarSection({
          cargoAvailable: () => true,
          loadMetadata: () => {
            throw new Error('metadata boom');
          },
        }),
      ).toBeNull();
      expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/metadata boom/));
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('generateThirdPartyLicenses', () => {
  /** @type {string[]} */
  const dirs = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  function makeExistingTarget() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-licenses-gen-'));
    dirs.push(dir);
    const targetPath = path.join(dir, 'third-party-licenses.md');
    const original = '# existing licenses\n';
    fs.writeFileSync(targetPath, original);
    return { targetPath, original };
  }

  it('writes the Rust section when the loader returns one', () => {
    const { targetPath } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {},
      loadReportTables: () => ({ prodTable: '| a |', devTable: '| b |' }),
      loadRustSection: () => 'RUST-BODY',
      formatMarkdownFile: () => {},
    });
    expect(code).toBe(0);
    expect(fs.readFileSync(targetPath, 'utf8')).toMatch(
      /## Rust sidecar dependencies\n\nRUST-BODY\n$/,
    );
  });

  it('writes the unavailable note when the loader returns null', () => {
    const { targetPath } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {},
      loadReportTables: () => ({ prodTable: '| a |', devTable: '| b |' }),
      loadRustSection: () => null,
      formatMarkdownFile: () => {},
    });
    expect(code).toBe(0);
    expect(fs.readFileSync(targetPath, 'utf8')).toContain(RUST_SECTION_UNAVAILABLE_NOTE);
  });

  it('returns 1 and leaves the target unchanged when license check fails', () => {
    const { targetPath, original } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {
        throw new Error('check failed');
      },
      loadReportTables: () => ({ prodTable: '| a |', devTable: '| b |' }),
      loadRustSection: () => null,
      formatMarkdownFile: () => {},
    });
    expect(code).toBe(1);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
  });

  it('returns 1 and leaves the target unchanged when report generation fails', () => {
    const { targetPath, original } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {},
      loadReportTables: () => {
        throw new Error('report failed');
      },
      loadRustSection: () => null,
      formatMarkdownFile: () => {},
    });
    expect(code).toBe(1);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
  });

  it('returns 1 and leaves the target unchanged when formatting fails', () => {
    const { targetPath, original } = makeExistingTarget();
    const code = generateThirdPartyLicenses({
      targetPath,
      checkLicenses: () => {},
      loadReportTables: () => ({ prodTable: '| a |', devTable: '| b |' }),
      loadRustSection: () => null,
      formatMarkdownFile: () => {
        throw new Error('format failed');
      },
    });
    expect(code).toBe(1);
    expect(fs.readFileSync(targetPath, 'utf8')).toBe(original);
  });
});
