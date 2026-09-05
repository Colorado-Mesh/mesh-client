// @vitest-environment node
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertApplicationsSymlink,
  assertDualArchMacArchives,
  assertDmgInstallNotice,
  assertMacMinimumSystemVersion,
  assertSiblingFrameworkSymlinks,
  classifyMacArchiveArch,
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

  it('classifyMacArchiveArch uses path and file-name markers', () => {
    expect(classifyMacArchiveArch('/r/mac-arm64/Mesh-client-1.0.0-arm64.dmg')).toBe('arm64');
    expect(classifyMacArchiveArch('/r/mac-x64/Mesh-client-1.0.0-x64.dmg')).toBe('x64');
    expect(classifyMacArchiveArch('/r/Mesh-client-1.0.0-arm64-mac.zip')).toBe('arm64');
    expect(classifyMacArchiveArch('/r/Mesh-client-1.0.0-x64-mac.zip')).toBe('x64');
    expect(classifyMacArchiveArch('/r/mac-universal/Mesh-client-1.0.0-universal.dmg')).toBe(
      'universal',
    );
    expect(classifyMacArchiveArch('/r/Mesh-client-1.0.0.dmg')).toBe('unknown');
  });

  it('assertDualArchMacArchives requires both arches', () => {
    expect(() =>
      assertDualArchMacArchives(
        [
          '/r/mac-arm64/Mesh-client-1.0.0-arm64.dmg',
          '/r/mac-arm64/Mesh-client-1.0.0-arm64-mac.zip',
        ],
        '.dmg',
      ),
    ).toThrow(/Expected both x64 and arm64 macOS \.dmg/);

    expect(() =>
      assertDualArchMacArchives(
        ['/r/mac-arm64/Mesh-client-1.0.0-arm64.dmg', '/r/mac-x64/Mesh-client-1.0.0-x64.dmg'],
        '.dmg',
      ),
    ).not.toThrow();

    expect(() =>
      assertDualArchMacArchives(
        [
          '/r/mac-arm64/Mesh-client-1.0.0-arm64-mac.zip',
          '/r/mac-x64/Mesh-client-1.0.0-x64-mac.zip',
        ],
        '.zip',
      ),
    ).not.toThrow();

    // Unscoped Intel name counts as x64 when arm64 sibling exists.
    expect(() =>
      assertDualArchMacArchives(
        ['/r/Mesh-client-1.0.0-arm64.dmg', '/r/Mesh-client-1.0.0.dmg'],
        '.dmg',
      ),
    ).not.toThrow();
  });

  it('assertDualArchMacArchives fails when a format is missing an arch', () => {
    // A mixed release (arm64 DMG + x64 ZIP only) looks dual-arch if lists are combined,
    // but each format must be dual-arch on its own.
    expect(() =>
      assertDualArchMacArchives(['/r/mac-arm64/Mesh-client-1.0.0-arm64.dmg'], '.dmg'),
    ).toThrow(/Expected both x64 and arm64 macOS \.dmg/);

    expect(() =>
      assertDualArchMacArchives(['/r/mac-x64/Mesh-client-1.0.0-x64-mac.zip'], '.zip'),
    ).toThrow(/Expected both x64 and arm64 macOS \.zip/);

    expect(() =>
      assertDualArchMacArchives(['/r/mac-arm64/Mesh-client-1.0.0-arm64-mac.zip'], '.zip'),
    ).toThrow(/Expected both x64 and arm64 macOS \.zip/);
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

  it('assertMacMinimumSystemVersion requires LSMinimumSystemVersion >= 13.0.0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-min-os-'));
    const bundle = join(dir, 'Mesh-client.app');
    const plistPath = join(bundle, 'Contents', 'Info.plist');
    try {
      mkdirSync(join(bundle, 'Contents'), { recursive: true });
      expect(() => assertMacMinimumSystemVersion(bundle, 'test')).toThrow(
        /Missing test Info\.plist/,
      );

      writeFileSync(plistPath, '<?xml version="1.0"?><plist><dict></dict></plist>');
      expect(() => assertMacMinimumSystemVersion(bundle, 'test')).toThrow(
        /missing LSMinimumSystemVersion/,
      );

      writeFileSync(
        plistPath,
        [
          '<?xml version="1.0"?>',
          '<plist><dict>',
          '<key>LSMinimumSystemVersion</key><string>12.0</string>',
          '</dict></plist>',
        ].join('\n'),
      );
      expect(() => assertMacMinimumSystemVersion(bundle, 'test')).toThrow(/need >= 13\.0\.0/);

      writeFileSync(
        plistPath,
        [
          '<?xml version="1.0"?>',
          '<plist><dict>',
          '<key>LSMinimumSystemVersion</key><string>13.0.0</string>',
          '</dict></plist>',
        ].join('\n'),
      );
      expect(() => assertMacMinimumSystemVersion(bundle, 'test')).not.toThrow();
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
