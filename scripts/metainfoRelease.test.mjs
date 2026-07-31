// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isValidReleaseSemver,
  metainfoVersionMismatchMessage,
  parseTopReleaseVersion,
  prependMetainfoRelease,
} from './metainfoRelease.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('metainfoRelease', () => {
  it('accepts X.Y.Z only', () => {
    expect(isValidReleaseSemver('5.25.0')).toBe(true);
    expect(isValidReleaseSemver('v5.25.0')).toBe(false);
    expect(isValidReleaseSemver('Version bumped successfully:\nmesh-client: 5.24.1 → 5.25.0')).toBe(
      false,
    );
  });

  it('parses top release version', () => {
    const xml = `<releases>\n    <release version="5.25.0" date="2026-07-31"/>\n`;
    expect(parseTopReleaseVersion(xml)).toBe('5.25.0');
  });

  it('mismatch message forbids re-running release and points at --finish', () => {
    const msg = metainfoVersionMismatchMessage('5.24.1', '5.25.0');
    expect(msg).toContain('Do NOT re-run `pnpm run release`');
    expect(msg).toContain('pnpm run release --finish');
    expect(msg).not.toMatch(/re-run `pnpm run release` or update MetaInfo manually/);
  });

  it('mismatch message flags corrupt non-semver MetaInfo versions', () => {
    const corrupt = 'Version bumped successfully:\nmesh-client: 5.24.1 → 5.25.0';
    const msg = metainfoVersionMismatchMessage(corrupt, '5.25.0');
    expect(msg).toContain('invalid/non-semver');
    expect(msg).toContain('Do NOT re-run `pnpm run release`');
    expect(msg).toContain('pnpm run release --finish');
  });

  it('prepends a validated release entry', () => {
    const xml = `  <releases>\n    <release version="5.24.1" date="2026-07-20"/>\n`;
    const next = prependMetainfoRelease(xml, '5.25.0', '2026-07-31');
    expect(next).toContain('<release version="5.25.0" date="2026-07-31"/>');
    expect(parseTopReleaseVersion(next)).toBe('5.25.0');
  });

  it('is idempotent when top version already matches', () => {
    const xml = `  <releases>\n    <release version="5.25.0" date="2026-07-31"/>\n`;
    expect(prependMetainfoRelease(xml, '5.25.0', '2026-07-31')).toBe(xml);
  });

  it('refuses to prepend garbage versions', () => {
    const xml = `  <releases>\n    <release version="5.24.1" date="2026-07-20"/>\n`;
    expect(() =>
      prependMetainfoRelease(xml, 'Version bumped successfully:\nx', '2026-07-31'),
    ).toThrow(/Refusing to write MetaInfo release/);
  });

  it('CLI helper writes only validated versions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-metainfo-'));
    const file = path.join(dir, 'metainfo.xml');
    fs.writeFileSync(
      file,
      `<?xml version="1.0"?>\n<component>\n  <releases>\n    <release version="5.24.1" date="2026-07-20"/>\n  </releases>\n</component>\n`,
    );
    const result = spawnSync(
      process.execPath,
      [path.join(HERE, 'prepend-metainfo-release.mjs'), '5.25.0', '2026-07-31', file],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(parseTopReleaseVersion(fs.readFileSync(file, 'utf8'))).toBe('5.25.0');
  });
});
