import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareReleaseTags,
  formatSchemaCompareMarkdown,
  isSchemaBumped,
  parseCurrentSchemaVersion,
  pickLatestPublishedReleaseTag,
  publishedReleaseGitTag,
  runSchemaReleaseCompare,
  trustedReleaseTag,
  trustedSchemaVersion,
  writeGithubOutput,
} from './ci-schema-release-compare.mjs';

describe('parseCurrentSchemaVersion', () => {
  it('parses the exported constant', () => {
    expect(parseCurrentSchemaVersion('export const CURRENT_SCHEMA_VERSION = 48;\n')).toBe(48);
  });

  it('rejects missing export', () => {
    expect(() => parseCurrentSchemaVersion('const x = 1;')).toThrow(/Could not parse/);
  });
});

describe('trustedReleaseTag / trustedSchemaVersion', () => {
  it('reconstructs tags from digit groups', () => {
    expect(trustedReleaseTag('v5.26.0')).toBe('v5.26.0');
    expect(trustedReleaseTag('v01.02.03')).toBe('v1.2.3');
  });

  it('rejects unsafe tags and schema values', () => {
    expect(() => trustedReleaseTag('../evil')).toThrow(/Unsafe release tag/);
    expect(() => trustedSchemaVersion(0)).toThrow(/Invalid schema version/);
    expect(() => trustedSchemaVersion('nope')).toThrow(/Invalid schema version/);
  });
});

describe('publishedReleaseGitTag', () => {
  it('uses tag_name when it is a normal vX.Y.Z release', () => {
    expect(
      publishedReleaseGitTag({
        tag_name: 'v5.25.0',
        name: '5.25.0',
        draft: false,
        prerelease: false,
      }),
    ).toBe('v5.25.0');
  });

  it('recovers vX.Y.Z from release name when tag_name is untagged-*', () => {
    // Regression: published 5.27.0 lost its git tag after draft-fork races;
    // compare used to skip it and warn against older v5.25.0 / schema 47.
    expect(
      publishedReleaseGitTag({
        tag_name: 'untagged-56bb16db7c14eda58971',
        name: '5.27.0',
        draft: false,
        prerelease: false,
      }),
    ).toBe('v5.27.0');
  });

  it('skips drafts and prereleases even with a valid tag_name', () => {
    expect(
      publishedReleaseGitTag({
        tag_name: 'v5.26.0',
        name: '5.26.0',
        draft: true,
        prerelease: false,
      }),
    ).toBeNull();
    expect(
      publishedReleaseGitTag({
        tag_name: 'v5.21.0',
        name: '5.21.0',
        draft: false,
        prerelease: true,
      }),
    ).toBeNull();
  });
});

describe('compareReleaseTags', () => {
  it('orders semver tags', () => {
    expect(compareReleaseTags('v5.25.0', 'v5.27.0')).toBeLessThan(0);
    expect(compareReleaseTags('v5.27.0', 'v5.25.0')).toBeGreaterThan(0);
    expect(compareReleaseTags('v5.27.0', 'v5.27.0')).toBe(0);
  });
});

describe('pickLatestPublishedReleaseTag', () => {
  it('prefers untagged published 5.27.0 over older tagged releases and skips drafts', () => {
    // Mirrors production list shape after the v5.27.0 publish race.
    const tag = pickLatestPublishedReleaseTag([
      { tag_name: 'v5.26.0', name: '5.26.0', draft: true, prerelease: false },
      {
        tag_name: 'untagged-56bb16db7c14eda58971',
        name: '5.27.0',
        draft: false,
        prerelease: false,
      },
      { tag_name: 'v5.25.0', name: '5.25.0', draft: false, prerelease: false },
    ]);
    expect(tag).toBe('v5.27.0');
  });

  it('honors excludeTag for the release being published', () => {
    const tag = pickLatestPublishedReleaseTag(
      [
        { tag_name: 'v5.28.0', name: '5.28.0', draft: false, prerelease: false },
        { tag_name: 'v5.27.0', name: '5.27.0', draft: false, prerelease: false },
      ],
      'v5.28.0',
    );
    expect(tag).toBe('v5.27.0');
  });
});

describe('isSchemaBumped', () => {
  it('is true only when current is greater than previous', () => {
    expect(isSchemaBumped(48, 47)).toBe(true);
    expect(isSchemaBumped(48, 48)).toBe(false);
    expect(isSchemaBumped(48, null)).toBe(false);
  });
});

describe('formatSchemaCompareMarkdown', () => {
  it('marks test builds and schema bumps', () => {
    const md = formatSchemaCompareMarkdown({
      mode: 'test-build',
      currSchema: 49,
      prevSchema: 48,
      prevTag: 'v5.26.0',
      schemaBumped: true,
    });
    expect(md).toContain('Test build — not an official release');
    expect(md).toContain('Build Binaries');
    expect(md).toContain('49');
    expect(md).toContain('v5.26.0');
    expect(md).toContain('48 → 49');
    expect(md).toContain('cannot downgrade');
  });

  it('uses a custom workflow label for Flatpak test builds', () => {
    const md = formatSchemaCompareMarkdown({
      mode: 'test-build',
      currSchema: 49,
      prevSchema: 48,
      prevTag: 'v5.26.0',
      schemaBumped: true,
      workflowLabel: 'Build Flatpak',
    });
    expect(md).toContain('Build Flatpak');
    expect(md).not.toContain('Build Binaries');
  });

  it('notes when there is no bump', () => {
    const md = formatSchemaCompareMarkdown({
      mode: 'test-build',
      currSchema: 48,
      prevSchema: 48,
      prevTag: 'v5.26.0',
      schemaBumped: false,
    });
    expect(md).toContain('No schema bump');
  });
});

describe('runSchemaReleaseCompare offline', () => {
  /** @type {string[]} */
  const temps = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const dir of temps.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes readme, summary, and outputs from env prev schema', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-compare-'));
    temps.push(dir);
    const readme = path.join(dir, 'READ-ME.md');
    const summary = path.join(dir, 'summary.md');
    const output = path.join(dir, 'github-output.txt');

    const result = await runSchemaReleaseCompare(['--offline', '--write-readme', readme], {
      MESH_CLIENT_SCHEMA_PREV: '40',
      MESH_CLIENT_SCHEMA_PREV_TAG: 'v5.20.0',
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
    });

    expect(result.schemaBumped).toBe(true);
    expect(result.prevTag).toBe('v5.20.0');
    expect(fs.readFileSync(readme, 'utf8')).toContain('Test build');
    expect(fs.readFileSync(summary, 'utf8')).toContain('cannot downgrade');
    const out = fs.readFileSync(output, 'utf8');
    expect(out).toContain('schema_bumped=true');
    expect(out).toContain('prev_schema=40');
    expect(out).toMatch(/curr_schema=\d+/);
  });
});

describe('writeGithubOutput', () => {
  it('appends key=value lines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-out-'));
    const file = path.join(dir, 'out.txt');
    writeGithubOutput({ a: '1', b: 'two' }, file);
    expect(fs.readFileSync(file, 'utf8')).toBe('a=1\nb=two\n');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
