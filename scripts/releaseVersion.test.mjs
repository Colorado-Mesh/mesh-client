// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  METAINFO_PATH,
  metainfoReleaseVersions,
  PACKAGE_JSON_PATH,
  parseSchemaVersion,
  readPackageVersion,
  resolveNextVersion,
  restoreMetainfoRelease,
  SCHEMA_SOURCE_PATH,
  setPackageVersion,
  takeTopMetainfoRelease,
  upsertMetainfoRelease,
} from './releaseVersion.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readRepoFile = (relativePath) => readFileSync(path.join(ROOT, relativePath), 'utf8');

/** Version lines of a MetaInfo document, top first, read without the code under test. */
const releaseLines = (xml) => xml.split('\n').filter((line) => line.includes('<release version='));

describe('readPackageVersion / setPackageVersion', () => {
  it('reads the semver version of the real package.json', () => {
    const text = readRepoFile(PACKAGE_JSON_PATH);
    expect(readPackageVersion(text)).toBe(JSON.parse(text).version);
  });

  it('rejects a version that is not X.Y.Z', () => {
    expect(() => readPackageVersion('{\n  "version": "6.8.0-beta.1"\n}\n')).toThrow(/X\.Y\.Z/);
  });

  it('changes only the top-level version line of the real package.json', () => {
    const before = readRepoFile(PACKAGE_JSON_PATH);
    const after = setPackageVersion(before, '99.0.0');
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    expect(afterLines).toHaveLength(beforeLines.length);
    const changed = afterLines.flatMap((line, index) =>
      line === beforeLines[index] ? [] : [index],
    );
    expect(changed).toHaveLength(1);
    expect(afterLines[changed[0]]).toBe('  "version": "99.0.0",');
    expect(JSON.parse(after).version).toBe('99.0.0');
  });

  it('refuses to guess when two top-level version keys exist', () => {
    const duplicated = '{\n  "name": "x",\n  "version": "1.0.0",\n  "version": "1.0.1"\n}\n';
    expect(() => setPackageVersion(duplicated, '2.0.0')).toThrow(/exactly one/);
  });

  it('ignores nested version keys', () => {
    const nested = '{\n  "version": "1.0.0",\n  "engines": {\n    "version": "keep"\n  }\n}\n';
    expect(setPackageVersion(nested, '1.1.0')).toBe(
      '{\n  "version": "1.1.0",\n  "engines": {\n    "version": "keep"\n  }\n}\n',
    );
  });
});

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('6.10.0', '6.9.9')).toBe(1);
    expect(compareVersions('6.9.9', '6.10.0')).toBe(-1);
    expect(compareVersions('6.8.0', '6.8.0')).toBe(0);
    expect(compareVersions('7.0.0', '6.99.99')).toBe(1);
  });
});

describe('resolveNextVersion', () => {
  it('applies the detected bump in auto mode', () => {
    expect(resolveNextVersion({ latestVersion: '6.8.0', bump: 'auto', detected: 'minor' })).toBe(
      '6.9.0',
    );
    expect(resolveNextVersion({ latestVersion: '6.8.0', bump: 'auto', detected: 'major' })).toBe(
      '7.0.0',
    );
  });

  it('applies an explicit bump kind', () => {
    expect(resolveNextVersion({ latestVersion: '6.8.0', bump: 'patch' })).toBe('6.8.1');
    expect(resolveNextVersion({ latestVersion: '6.8.0', bump: 'minor' })).toBe('6.9.0');
  });

  it('keeps the latest version for a promotion without a release', () => {
    expect(resolveNextVersion({ latestVersion: '6.8.0', bump: 'none' })).toBe('6.8.0');
  });

  it('accepts an exact version only when it is newer', () => {
    expect(resolveNextVersion({ latestVersion: '6.8.0', bump: '6.10.0' })).toBe('6.10.0');
    expect(() => resolveNextVersion({ latestVersion: '6.8.0', bump: '6.8.0' })).toThrow(
      /greater than 6\.8\.0/,
    );
    expect(() => resolveNextVersion({ latestVersion: '6.8.0', bump: '6.7.9' })).toThrow(
      /greater than 6\.8\.0/,
    );
  });

  it('rejects unknown bumps and auto without a detected kind', () => {
    expect(() => resolveNextVersion({ latestVersion: '6.8.0', bump: 'huge' })).toThrow(/bump/);
    expect(() => resolveNextVersion({ latestVersion: '6.8.0', bump: 'auto' })).toThrow(/detected/);
  });
});

describe('upsertMetainfoRelease', () => {
  const realXml = readRepoFile(METAINFO_PATH);
  const latest = /<release version="(\d+\.\d+\.\d+)"/.exec(realXml)[1];

  it('prepends the new release above the released ones', () => {
    const next = upsertMetainfoRelease(realXml, {
      version: '99.0.0',
      date: '2026-11-20',
      latestVersion: latest,
    });
    const lines = releaseLines(next);
    expect(lines[0].trim()).toBe('<release version="99.0.0" date="2026-11-20"/>');
    expect(lines.slice(1)).toEqual(releaseLines(realXml));
  });

  it('replaces an unreleased top entry instead of stacking a second one', () => {
    const first = upsertMetainfoRelease(realXml, {
      version: '99.0.0',
      date: '2026-11-20',
      latestVersion: latest,
    });
    const second = upsertMetainfoRelease(first, {
      version: '99.0.1',
      date: '2026-11-21',
      latestVersion: latest,
    });
    const lines = releaseLines(second);
    expect(lines[0].trim()).toBe('<release version="99.0.1" date="2026-11-21"/>');
    expect(lines.slice(1)).toEqual(releaseLines(realXml));
  });

  it('returns the document unchanged when the top entry already has the version', () => {
    const once = upsertMetainfoRelease(realXml, {
      version: '99.0.0',
      date: '2026-11-20',
      latestVersion: latest,
    });
    expect(
      upsertMetainfoRelease(once, { version: '99.0.0', date: '2030-01-01', latestVersion: latest }),
    ).toBe(once);
  });
});

describe('back-port MetaInfo helpers', () => {
  const realXml = readRepoFile(METAINFO_PATH);
  const latest = /<release version="(\d+\.\d+\.\d+)"/.exec(realXml)[1];
  const bumped = upsertMetainfoRelease(realXml, {
    version: '99.0.0',
    date: '2026-11-20',
    latestVersion: latest,
  });

  it('splits off the entry a bump added and gives back the file it started from', () => {
    expect(takeTopMetainfoRelease(bumped)).toEqual({
      version: '99.0.0',
      date: '2026-11-20',
      xml: realXml,
    });
  });

  it('refuses a top entry in any other shape, even when a later entry has the bump shape', () => {
    const described = bumped.replace(
      '<release version="99.0.0" date="2026-11-20"/>',
      '<release version="99.0.0" date="2026-11-20">\n      <description><p>Notes</p></description>\n    </release>',
    );
    expect(takeTopMetainfoRelease(described)).toBeNull();
  });

  it('puts an unreleased entry back on top of a merged list', () => {
    expect(restoreMetainfoRelease(realXml, { version: '99.0.0', date: '2026-11-20' })).toBe(bumped);
  });

  it('adds nothing when the merged list already reaches that version', () => {
    expect(restoreMetainfoRelease(bumped, { version: '98.0.0', date: '2026-11-19' })).toBe(bumped);
    expect(restoreMetainfoRelease(bumped, { version: '99.0.0', date: '2026-11-19' })).toBe(bumped);
  });

  it('lists every release version, top first', () => {
    expect(metainfoReleaseVersions(bumped).slice(0, 2)).toEqual(['99.0.0', latest]);
  });
});

describe('parseSchemaVersion', () => {
  it('reads the declared schema version', () => {
    expect(parseSchemaVersion('export const CURRENT_SCHEMA_VERSION = 54;\n')).toBe(54);
  });

  it('finds the declaration in the real schema module', () => {
    const value = parseSchemaVersion(readRepoFile(SCHEMA_SOURCE_PATH));
    expect(Number.isInteger(value) && value > 0).toBe(true);
  });

  it('throws when the declaration is missing', () => {
    expect(() => parseSchemaVersion('export const OTHER = 1;\n')).toThrow(/CURRENT_SCHEMA_VERSION/);
  });
});
