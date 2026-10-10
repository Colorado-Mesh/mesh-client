// @vitest-environment node
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertApplicationsSymlink,
  assertDualArchMacArchives,
  assertDmgInstallNotice,
  assertLipoArchsMatch,
  assertMacCodeSignature,
  assertMacMinimumSystemVersion,
  assertSiblingFrameworkSymlinks,
  classifyMacArchiveArch,
  collectArchives,
  expectedLipoArchsForMacArch,
  isDeveloperIdApplicationAuthority,
  resolveMacSignatureOptions,
  resolveExpectedMacArch,
  VerificationFailure,
  fail,
  isCompleteAppBundle,
  pickPrimaryArchive,
} from './verify-mac-packaging.mjs';

const DEVELOPER_ID_CODESIGN_DV = [
  'Executable=/Applications/Mesh-client.app/Contents/MacOS/Mesh-client',
  'Identifier=com.mesh-client.app',
  'Format=app bundle with Mach-O thin (arm64)',
  'Authority=Developer ID Application: Example Developer (ABCD123456)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=ABCD123456',
  'Runtime Version=26.5.0',
].join('\n');

const ADHOC_CODESIGN_DV = [
  'Executable=/tmp/Mesh-client.app/Contents/MacOS/Mesh-client',
  'Identifier=com.mesh-client.app',
  'Signature=adhoc',
  'TeamIdentifier=not set',
].join('\n');

const UNSIGNED_CODESIGN_DV = '/tmp/Mesh-client.app: code object is not signed at all\n';
const WRONG_TEAM_CODESIGN_DV = DEVELOPER_ID_CODESIGN_DV.replaceAll('ABCD123456', 'ZYXW987654');

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

  it('collectArchives includes both root and nested artifacts eligible for upload', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-archives-'));
    const nestedDir = join(dir, 'mac-stale');
    const rootArchive = join(dir, 'Mesh-client-x64.dmg');
    const nestedArchive = join(nestedDir, 'Mesh-client-arm64.dmg');
    try {
      mkdirSync(nestedDir);
      writeFileSync(rootArchive, 'root');
      writeFileSync(nestedArchive, 'nested');
      expect(collectArchives(dir, '.dmg')).toEqual(
        [rootArchive, nestedArchive].sort((a, b) => a.localeCompare(b)),
      );
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

  it('resolveExpectedMacArch maps labels and defaults unscoped to x64', () => {
    expect(resolveExpectedMacArch('/r/mac-arm64/Mesh-client.app')).toBe('arm64');
    expect(resolveExpectedMacArch('/r/Mesh-client-1.0.0-x64.dmg')).toBe('x64');
    expect(resolveExpectedMacArch('/r/Mesh-client-1.0.0.dmg')).toBe('x64');
    expect(expectedLipoArchsForMacArch('arm64')).toEqual(['arm64']);
    expect(expectedLipoArchsForMacArch('x64')).toEqual(['x86_64']);
    expect(expectedLipoArchsForMacArch('universal')).toEqual(['arm64', 'x86_64']);
  });

  it('assertLipoArchsMatch rejects filename/binary architecture disagreement', () => {
    // arm64-labeled archive whose launcher is actually Intel.
    expect(() =>
      assertLipoArchsMatch('zip:Mesh-client-1.0.0-arm64-mac.zip', 'launcher', ['x86_64'], 'arm64'),
    ).toThrow(/launcher Mach-O archs \[x86_64\] do not match expected arm64 \[arm64\]/);

    // x64-labeled archive whose framework is arm64-only.
    expect(() =>
      assertLipoArchsMatch('dmg:Mesh-client-1.0.0-x64.dmg', 'Electron Framework', ['arm64'], 'x64'),
    ).toThrow(/Electron Framework Mach-O archs \[arm64\] do not match expected x64 \[x86_64\]/);

    expect(() =>
      assertLipoArchsMatch('zip:Mesh-client-1.0.0-x64-mac.zip', 'launcher', ['x86_64'], 'x64'),
    ).not.toThrow();

    expect(() =>
      assertLipoArchsMatch(
        'zip:Mesh-client-1.0.0-universal-mac.zip',
        'launcher',
        ['x86_64', 'arm64'],
        'universal',
      ),
    ).not.toThrow();
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

  it('isDeveloperIdApplicationAuthority detects Developer ID Application lines', () => {
    expect(isDeveloperIdApplicationAuthority(DEVELOPER_ID_CODESIGN_DV)).toBe(true);
    expect(
      isDeveloperIdApplicationAuthority(
        DEVELOPER_ID_CODESIGN_DV.replace('TeamIdentifier=ABCD123456', 'TeamIdentifier=ZYXW987654'),
      ),
    ).toBe(false);
    expect(isDeveloperIdApplicationAuthority(ADHOC_CODESIGN_DV)).toBe(false);
    expect(isDeveloperIdApplicationAuthority(UNSIGNED_CODESIGN_DV)).toBe(false);
    expect(isDeveloperIdApplicationAuthority('')).toBe(false);
  });

  it('resolveMacSignatureOptions requires a valid team for required policy', () => {
    expect(resolveMacSignatureOptions({})).toEqual({ policy: 'optional' });
    expect(
      resolveMacSignatureOptions({
        MESH_CLIENT_MAC_SIGNATURE_POLICY: 'required',
        MESH_CLIENT_EXPECTED_MAC_TEAM_ID: 'ABCD123456',
      }),
    ).toEqual({ policy: 'required', expectedTeamId: 'ABCD123456' });
    expect(() =>
      resolveMacSignatureOptions({ MESH_CLIENT_MAC_SIGNATURE_POLICY: 'required' }),
    ).toThrow(/needs MESH_CLIENT_EXPECTED_MAC_TEAM_ID/);
    expect(() =>
      resolveMacSignatureOptions({
        MESH_CLIENT_MAC_SIGNATURE_POLICY: 'required',
        MESH_CLIENT_EXPECTED_MAC_TEAM_ID: 'bad-team',
      }),
    ).toThrow(/10-character Apple team identifier/);
  });

  it('assertMacCodeSignature skips unsigned and ad-hoc displays only in optional mode', () => {
    const calls = { deep: 0, staple: 0, sidecar: 0 };
    const skipDeps = {
      readDisplay: () => ({ status: 1, text: UNSIGNED_CODESIGN_DV }),
      verifyDeepStrict: () => {
        calls.deep += 1;
        return { status: 0, text: '' };
      },
      staplerValidate: () => {
        calls.staple += 1;
        return { status: 0, text: '' };
      },
      verifyStrict: () => {
        calls.sidecar += 1;
        return { status: 0, text: '' };
      },
      resolveSidecarPath: () => '/tmp/mesh-client-reticulum',
    };

    expect(() =>
      assertMacCodeSignature('/tmp/Mesh-client.app', 'unsigned', { policy: 'optional' }, skipDeps),
    ).not.toThrow();
    expect(() =>
      assertMacCodeSignature(
        '/tmp/Mesh-client.app',
        'adhoc',
        { policy: 'optional' },
        {
          ...skipDeps,
          readDisplay: () => ({ status: 0, text: ADHOC_CODESIGN_DV }),
        },
      ),
    ).not.toThrow();
    expect(calls).toEqual({ deep: 0, staple: 0, sidecar: 0 });

    expect(() =>
      assertMacCodeSignature(
        '/tmp/Mesh-client.app',
        'unsigned-release',
        { policy: 'required', expectedTeamId: 'ABCD123456' },
        skipDeps,
      ),
    ).toThrow(/not signed by the required Developer ID Application identity/);
    expect(() =>
      assertMacCodeSignature(
        '/tmp/Mesh-client.app',
        'wrong-team',
        { policy: 'required', expectedTeamId: 'ABCD123456' },
        { ...skipDeps, readDisplay: () => ({ status: 0, text: WRONG_TEAM_CODESIGN_DV }) },
      ),
    ).toThrow(/Developer ID team ZYXW987654 does not match ABCD123456/);
  });

  it('assertMacCodeSignature enforces deep strict, stapler, and the sidecar identity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mac-codesign-'));
    const sidecarPath = join(dir, 'mesh-client-reticulum');
    writeFileSync(sidecarPath, 'x');
    const seen = /** @type {string[]} */ ([]);
    try {
      expect(() =>
        assertMacCodeSignature(
          '/tmp/Mesh-client.app',
          'signed',
          { policy: 'required', expectedTeamId: 'ABCD123456' },
          {
            readDisplay: () => ({ status: 0, text: DEVELOPER_ID_CODESIGN_DV }),
            verifyDeepStrict: (target) => {
              seen.push(`deep:${target}`);
              return { status: 0, text: 'valid on disk\n' };
            },
            staplerValidate: (target) => {
              seen.push(`staple:${target}`);
              return { status: 0, text: 'The validate action worked!\n' };
            },
            verifyStrict: (target) => {
              seen.push(`sidecar:${target}`);
              return { status: 0, text: 'valid on disk\n' };
            },
            resolveSidecarPath: () => sidecarPath,
          },
        ),
      ).not.toThrow();
      expect(seen).toEqual([
        'deep:/tmp/Mesh-client.app',
        'staple:/tmp/Mesh-client.app',
        `sidecar:${sidecarPath}`,
      ]);

      expect(() =>
        assertMacCodeSignature(
          '/tmp/Mesh-client.app',
          'broken',
          { policy: 'required', expectedTeamId: 'ABCD123456' },
          {
            readDisplay: () => ({ status: 0, text: DEVELOPER_ID_CODESIGN_DV }),
            verifyDeepStrict: () => ({
              status: 1,
              text: 'invalid signature (code or signature have been modified)\n',
            }),
            staplerValidate: () => ({ status: 0, text: '' }),
            verifyStrict: () => ({ status: 0, text: '' }),
            resolveSidecarPath: () => sidecarPath,
          },
        ),
      ).toThrow(/codesign --verify --deep --strict failed/);

      expect(() =>
        assertMacCodeSignature(
          '/tmp/Mesh-client.app',
          'unstapled',
          { policy: 'required', expectedTeamId: 'ABCD123456' },
          {
            readDisplay: () => ({ status: 0, text: DEVELOPER_ID_CODESIGN_DV }),
            verifyDeepStrict: () => ({ status: 0, text: '' }),
            staplerValidate: () => ({ status: 1, text: 'Error: no ticket\n' }),
            verifyStrict: () => ({ status: 0, text: '' }),
            resolveSidecarPath: () => sidecarPath,
          },
        ),
      ).toThrow(/stapler validate failed/);

      expect(() =>
        assertMacCodeSignature(
          '/tmp/Mesh-client.app',
          'bad-sidecar',
          { policy: 'required', expectedTeamId: 'ABCD123456' },
          {
            readDisplay: () => ({ status: 0, text: DEVELOPER_ID_CODESIGN_DV }),
            verifyDeepStrict: () => ({ status: 0, text: '' }),
            staplerValidate: () => ({ status: 0, text: '' }),
            verifyStrict: () => ({ status: 1, text: 'code object is not signed at all\n' }),
            resolveSidecarPath: () => sidecarPath,
          },
        ),
      ).toThrow(/sidecar codesign --verify --strict failed/);

      expect(() =>
        assertMacCodeSignature(
          '/tmp/Mesh-client.app',
          'wrong-sidecar-team',
          { policy: 'required', expectedTeamId: 'ABCD123456' },
          {
            readDisplay: (target) => ({
              status: 0,
              text: target === sidecarPath ? WRONG_TEAM_CODESIGN_DV : DEVELOPER_ID_CODESIGN_DV,
            }),
            verifyDeepStrict: () => ({ status: 0, text: '' }),
            staplerValidate: () => ({ status: 0, text: '' }),
            verifyStrict: () => ({ status: 0, text: '' }),
            resolveSidecarPath: () => sidecarPath,
          },
        ),
      ).toThrow(/sidecar Developer ID team ZYXW987654 does not match ABCD123456/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
