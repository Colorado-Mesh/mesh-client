// @vitest-environment node
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertApplicationsSymlink,
  assertDmgInstallNotice,
  assertSiblingFrameworkSymlinks,
  VerificationFailure,
  fail,
  isCompleteAppBundle,
  pickPrimaryArchive,
} from './verify-mac-packaging.mjs';

describe('verify-mac-packaging helpers', () => {
  it('fail throws VerificationFailure for finally detach cleanup', () => {
    let detached = false;
    try {
      try {
        fail('validation failed');
      } finally {
        detached = true;
      }
    } catch (e) {
      expect(e).toBeInstanceOf(VerificationFailure);
      expect(e.message).toBe('validation failed');
    }
    expect(detached).toBe(true);
  });

  it('pickPrimaryArchive chooses the largest file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-packaging-test-'));
    try {
      const small = join(dir, 'small.zip');
      const large = join(dir, 'large.zip');
      const medium = join(dir, 'medium.zip');
      writeFileSync(small, 'a');
      writeFileSync(medium, 'abc');
      writeFileSync(large, 'abcdefgh');
      expect(pickPrimaryArchive([small, large, medium])).toBe(large);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('isCompleteAppBundle returns false for missing launcher paths', () => {
    expect(isCompleteAppBundle('/nonexistent/Mesh-client.app')).toBe(false);
  });

  it('assertApplicationsSymlink accepts Applications → /Applications', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-apps-link-'));
    try {
      symlinkSync('/Applications', join(dir, 'Applications'));
      expect(() => assertApplicationsSymlink(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assertApplicationsSymlink rejects missing or wrong-target links', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-apps-link-bad-'));
    try {
      expect(() => assertApplicationsSymlink(dir)).toThrow(VerificationFailure);

      writeFileSync(join(dir, 'Applications'), 'not-a-symlink');
      expect(() => assertApplicationsSymlink(dir)).toThrow(/must be a symlink/);

      rmSync(join(dir, 'Applications'));
      symlinkSync('/tmp', join(dir, 'Applications'));
      expect(() => assertApplicationsSymlink(dir)).toThrow(/must target \/Applications/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assertDmgInstallNotice requires IMPORTANT-Read-Me.txt', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-dmg-notice-'));
    try {
      expect(() => assertDmgInstallNotice(dir)).toThrow(VerificationFailure);
      writeFileSync(join(dir, 'IMPORTANT-Read-Me.txt'), 'macOS install notice '.repeat(8));
      expect(() => assertDmgInstallNotice(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assertSiblingFrameworkSymlinks rejects flattened Squirrel.framework root link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-squirrel-'));
    const bundle = join(dir, 'Mesh-client.app');
    const fwRoot = join(bundle, 'Contents', 'Frameworks', 'Squirrel.framework');
    try {
      mkdirSync(join(fwRoot, 'Versions', 'A'), { recursive: true });
      writeFileSync(join(fwRoot, 'Versions', 'A', 'Squirrel'), 'x'.repeat(2048));
      writeFileSync(join(fwRoot, 'Squirrel'), 'not-a-symlink');
      symlinkSync('A', join(fwRoot, 'Versions', 'Current'));
      expect(() =>
        assertSiblingFrameworkSymlinks(bundle, 'test', {
          dir: 'Squirrel.framework',
          binary: 'Squirrel',
          minBytes: 1024,
        }),
      ).toThrow(/must be a symlink/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
