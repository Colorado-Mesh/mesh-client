// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

const SEMVER_CORE_RE = /^\d+\.\d+\.\d+$/;

function stripSemverRange(version: string): string {
  return version.replace(/^[^\d]*/, '');
}

function expectSemverParts(
  version: string | undefined,
  label: string,
): [major: number, minor: number, patch: number] {
  expect(version, label).toBeDefined();
  const core = stripSemverRange(version!);
  expect(core, `${label} semver`).toMatch(SEMVER_CORE_RE);
  const parts = core.split('.').map(Number);
  expect(parts, `${label} segments`).toHaveLength(3);
  for (const part of parts) {
    expect(Number.isFinite(part), `${label} numeric segment`).toBe(true);
  }
  return parts as [number, number, number];
}

describe('Windows packaging (contract)', () => {
  it('does not use afterPack resedit or longPathAware manifest embedding', () => {
    const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).not.toContain('afterPack:');

    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies?.resedit).toBeUndefined();
    expect(packageJson.devDependencies?.rcedit).toBeUndefined();
  });

  it('declares readable-stream as a direct production dep with pnpm patch for asar packaging', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    const workspaceYaml = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf-8');
    const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf-8');
    expect(packageJson.dependencies?.['readable-stream']).toMatch(/^[~^]?4\.\d+\.\d+$/);

    const readableStreamLockRe = /^ {2}readable-stream@(4\.\d+\.\d+):$/m;
    const resolvedMatch = readableStreamLockRe.exec(lockfile);
    expect(resolvedMatch).not.toBeNull();
    const resolvedVersion = resolvedMatch![1];
    expect(workspaceYaml).toContain(
      `readable-stream@${resolvedVersion}: patches/readable-stream@${resolvedVersion}.patch`,
    );
  });

  it('keeps the @electron/asar pnpm override on v4 or newer for Windows packaging', () => {
    const workspaceYaml = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf-8');
    const overrideMatch = /^ {2}'@electron\/asar':\s*(.+)$/m.exec(workspaceYaml);
    const override = overrideMatch?.[1]?.trim();
    const [major] = expectSemverParts(override, '@electron/asar override');
    expect(major).toBeGreaterThanOrEqual(4);

    const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf-8');
    expect(lockfile).toMatch(/'@electron\/asar': [~^]?4\.\d+/);
  });

  it('skips dedupe:dist in dist:win scripts; hoisted install helper runs before packaging', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    for (const scriptName of ['dist:win', 'dist:win:publish'] as const) {
      const script = packageJson.scripts?.[scriptName];
      expect(script, scriptName).toBeDefined();
      expect(script).not.toContain('dedupe:dist');
      expect(script).toMatch(
        /pnpm run build && node scripts\/dist-win-hoisted-install\.mjs && electron-builder --win/,
      );
      expect(script).toContain('node scripts/verify-win-packaging.mjs');
      expect(script).toContain('node scripts/dist-win-restore-node-modules.mjs');
    }
  });

  it('disables universal NSIS, includes post-install guard, and verifies split Windows installers', () => {
    const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).toMatch(/beforePack:\s*scripts\/electron-builder-before-pack\.mjs/);
    expect(yml).toMatch(/nsis:\s*\n\s*buildUniversalInstaller:\s*false/);
    expect(yml).toMatch(/useZip:\s*true/);
    expect(yml).toMatch(/differentialPackage:\s*false/);
    expect(yml).toContain('include: resources/installer.nsh');

    const installerNsh = readFileSync(join(REPO_ROOT, 'resources', 'installer.nsh'), 'utf-8');
    expect(installerNsh).toContain('Mesh-client.exe');
    expect(installerNsh).toContain('customInstall');

    const verifyScript = readFileSync(
      join(REPO_ROOT, 'scripts', 'verify-win-packaging.mjs'),
      'utf-8',
    );
    expect(verifyScript).toContain('win-arm64-unpacked');
    expect(verifyScript).toContain('collectWinSetupInstallers');
    expect(verifyScript).toContain('win-setup-installer-names');
    expect(verifyScript).toContain('reticulum-sidecar');
    expect(verifyScript).toContain('assertBundledReticulumSidecarInBundle');
    expect(verifyScript).not.toContain('resedit');

    const setupNamesScript = readFileSync(
      join(REPO_ROOT, 'scripts', 'win-setup-installer-names.mjs'),
      'utf-8',
    );
    expect(setupNamesScript).toContain('-arm64.exe');
    expect(setupNamesScript).toContain('^-run\\d+-arm64$');
  });

  it('pins electron-builder to 26.15.4 or newer', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      devDependencies?: Record<string, string>;
    };
    const [major, minor, patch] = expectSemverParts(
      packageJson.devDependencies?.['electron-builder'],
      'electron-builder',
    );
    expect(major).toBe(26);
    expect(minor).toBeGreaterThanOrEqual(15);
    if (minor === 15) {
      expect(patch).toBeGreaterThanOrEqual(4);
    }
  });

  it('runs NSIS install smoke tests in Windows CI workflows', () => {
    const installScript = readFileSync(
      join(REPO_ROOT, 'scripts', 'test-win-nsis-install.mjs'),
      'utf-8',
    );
    expect(installScript).toContain('--arch x64');
    expect(installScript).toContain('--probe-7z');
    expect(installScript).toContain('assertBundledReticulumSidecarInBundle');
    expect(installScript).toContain('/LOG=');
    expect(installScript).toContain('find-nsis-app-archive.mjs');
    expect(installScript).toContain("dumpDir('release dir (installer missing)'");

    const finderScript = readFileSync(
      join(REPO_ROOT, 'scripts', 'find-nsis-app-archive.mjs'),
      'utf-8',
    );
    expect(finderScript).toContain('$PLUGINSDIR');
    expect(finderScript).toContain('findAppArchive');

    const buildWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'build.yaml'),
      'utf-8',
    );
    expect(buildWorkflow).toMatch(/- os: windows-latest\s*\n\s+build_script: pnpm run dist:win/);
    expect(buildWorkflow).toContain(
      "contains(matrix.build_script, 'dist:win') && matrix.os != 'windows-latest'",
    );
    expect(buildWorkflow).toContain('packaging-smoke:');
    expect(buildWorkflow).toContain('label: x64 NSIS install');
    expect(buildWorkflow).toContain('node scripts/test-win-nsis-install.mjs --arch x64');
    expect(buildWorkflow).toContain('label: arm64 NSIS install (WoA)');
    expect(buildWorkflow).toContain('- os: windows-11-vs2026-arm');
    expect(buildWorkflow).toContain(
      'node scripts/test-win-nsis-install.mjs --arch arm64 --probe-7z',
    );
    expect(buildWorkflow).toContain('needs: build');
    expect(buildWorkflow).not.toContain('win-arm64-install:');
    // READ-ME-FIRST must live under release/ in uploads so artifact LCA stays release/
    // (paths outside release/ nest as release/release/*.exe and break packaging-smoke).
    const stageReadmeIdx = buildWorkflow.indexOf('Stage READ-ME-FIRST into release output');
    expect(stageReadmeIdx).toBeGreaterThan(-1);
    const firstUploadIdx = Math.min(
      ...(
        ['Upload macOS Artifact', 'Upload Linux Artifact', 'Upload Windows Artifact'] as const
      ).map((name) => {
        const idx = buildWorkflow.indexOf(name);
        expect(idx, name).toBeGreaterThan(-1);
        return idx;
      }),
    );
    expect(stageReadmeIdx).toBeLessThan(firstUploadIdx);
    for (const uploadName of [
      'Upload macOS Artifact',
      'Upload Linux Artifact',
      'Upload Windows Artifact',
    ] as const) {
      const start = buildWorkflow.indexOf(`- name: ${uploadName}`);
      expect(start, uploadName).toBeGreaterThan(-1);
      const nextStep = buildWorkflow.indexOf('\n      - name:', start + 1);
      const block = buildWorkflow.slice(start, nextStep === -1 ? undefined : nextStep);
      expect(block).toContain('release/READ-ME-FIRST-test-build.md');
      expect(block).not.toContain('release-warnings/READ-ME-FIRST-test-build.md');
    }

    const buildJobBlock = buildWorkflow.slice(
      buildWorkflow.indexOf('  build:'),
      buildWorkflow.indexOf('  packaging-smoke:'),
    );
    expect(buildJobBlock).not.toContain('- name: Smoke test macOS packaging');
    expect(buildJobBlock).not.toContain('- name: Smoke test Linux packaging');
    expect(buildJobBlock).not.toContain('- name: Smoke test x64 NSIS install');

    const releaseWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'release.yaml'),
      'utf-8',
    );
    expect(readFileSync(join(REPO_ROOT, 'scripts', 'resolve-release-matrix.mjs'), 'utf-8')).toMatch(
      /platform_key:\s*'win'[\s\S]*build_script:\s*'pnpm run dist:win'/,
    );
    expect(readFileSync(join(REPO_ROOT, 'scripts', 'resolve-release-matrix.mjs'), 'utf-8')).toMatch(
      /platform_key:\s*'mac'[\s\S]*rust_targets:\s*'x86_64-apple-darwin,aarch64-apple-darwin'/,
    );
    expect(releaseWorkflow).toContain('scripts/resolve-release-matrix.mjs');
    expect(releaseWorkflow).toContain(
      "contains(matrix.build_script, 'dist:win') && matrix.os != 'windows-latest'",
    );
    expect(releaseWorkflow).toContain('packaging-smoke:');
    expect(releaseWorkflow).toContain('label: x64 NSIS install');
    expect(releaseWorkflow).toContain('node scripts/test-win-nsis-install.mjs --arch x64');
    expect(releaseWorkflow).toContain('label: arm64 NSIS install (WoA)');
    expect(releaseWorkflow).toContain('- os: windows-11-vs2026-arm');
    expect(releaseWorkflow).toContain(
      'node scripts/test-win-nsis-install.mjs --arch arm64 --probe-7z',
    );
    expect(releaseWorkflow).toContain('needs: [release, finalize-github-release]');
    expect(releaseWorkflow).not.toContain('win-arm64-install:');

    const releaseJobBlock = releaseWorkflow.slice(
      releaseWorkflow.indexOf('  release:'),
      releaseWorkflow.indexOf('  packaging-smoke:'),
    );
    expect(releaseJobBlock).not.toContain('- name: Smoke test macOS packaging');
    expect(releaseJobBlock).not.toContain('- name: Smoke test Linux packaging');
    expect(releaseJobBlock).not.toContain('- name: Smoke test x64 NSIS install');
  });

  it('runs macOS and Linux packaging smoke tests in dist scripts and CI workflows', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    for (const scriptName of ['dist:mac', 'dist:mac:publish'] as const) {
      const script = packageJson.scripts?.[scriptName];
      expect(script, scriptName).toBeDefined();
      expect(script).toContain('--mac --x64 --arm64');
      expect(script).toContain('node scripts/verify-mac-packaging.mjs');
    }
    for (const scriptName of ['dist:linux', 'dist:linux:publish'] as const) {
      const script = packageJson.scripts?.[scriptName];
      expect(script, scriptName).toBeDefined();
      expect(script).toContain('node scripts/verify-linux-packaging.mjs');
    }

    const macVerify = readFileSync(join(REPO_ROOT, 'scripts', 'verify-mac-packaging.mjs'), 'utf-8');
    expect(macVerify).toContain('.app');
    expect(macVerify).toContain("'Contents', 'MacOS'");
    expect(macVerify).toContain('Electron Framework.framework');
    expect(macVerify).toContain('Mesh-client');
    expect(macVerify).toContain('ditto -xk');
    expect(macVerify).toContain('hdiutil attach');
    expect(macVerify).toContain('isSymbolicLink');
    expect(macVerify).toContain('assertApplicationsSymlink');
    expect(macVerify).toContain('assertDmgInstallNotice');
    expect(macVerify).toContain('assertDualArchMacArchives');
    expect(macVerify).toContain('classifyMacArchiveArch');
    expect(macVerify).toContain('resolveExpectedMacArch');
    expect(macVerify).toContain('assertLipoArchsMatch');
    expect(macVerify).toContain("lipo', ['-archs'");
    expect(macVerify).toContain('stageMacosInstallNoticeReleaseAsset');
    expect(macVerify).toContain('Squirrel.framework');
    expect(macVerify).toContain('/Applications');
    expect(macVerify).toMatch(
      /function mountDmgAndValidate\([\s\S]*?assertApplicationsSymlink\(mountDir\)/,
    );
    expect(macVerify).toMatch(
      /function mountDmgAndValidate[\s\S]*let attached = false[\s\S]*if \(attached\)[\s\S]*detachDmgMount\(mountDir\)/,
    );
    expect(macVerify).toMatch(
      /} finally \{\s*\/\/ mountDmgAndValidate owns detach[\s\S]*rmSync\(dmgMountDir/,
    );
    expect(macVerify).not.toMatch(
      /} finally \{\s*\/\/ mountDmgAndValidate owns detach[\s\S]*detachDmgMount\(dmgMountDir\)/,
    );
    expect(macVerify).toContain('mkdtempSync');
    expect(macVerify).toContain('mesh-verify-mac-zip-');
    expect(macVerify).toContain('mesh-verify-mac-dmg-');
    expect(macVerify).toContain("assertDualArchMacArchives(dmgArchives, '.dmg')");
    expect(macVerify).toContain("assertDualArchMacArchives(zipArchives, '.zip')");
    expect(macVerify).toMatch(/for \(const zipPath of zipArchives\)/);
    expect(macVerify).toMatch(/for \(const dmgPath of dmgArchives\)[\s\S]*mountDmgAndValidate/);
    expect(macVerify).toMatch(/validateAppBundle\(zipBundle, zipLabel, expectedArch\)/);
    expect(macVerify).toMatch(/validateAppBundle\(dmgBundle, dmgLabel, expectedArch\)/);

    const buildWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'build.yaml'),
      'utf-8',
    );
    expect(buildWorkflow).toContain('rust_targets: x86_64-apple-darwin,aarch64-apple-darwin');
    expect(buildWorkflow).toContain('release/mac-x64/**/*.dmg');
    expect(buildWorkflow).toContain('release/mac-x64/**/*.zip');

    const releaseWorkflowMacUpload = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'release.yaml'),
      'utf-8',
    );
    expect(releaseWorkflowMacUpload).toContain('release/mac-x64/**/*.dmg');
    expect(releaseWorkflowMacUpload).toContain('release/mac-x64/**/*.zip');

    const sidecarWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'reticulum-sidecar.yaml'),
      'utf-8',
    );
    expect(sidecarWorkflow).toContain('target: x86_64-apple-darwin');
    expect(sidecarWorkflow).toContain('mesh-client-reticulum-macos-x64');
    expect(sidecarWorkflow).toContain('mesh-client-reticulum-rns-macos-x64');

    const staging = readFileSync(
      join(REPO_ROOT, 'scripts', 'reticulum-sidecar-staging.mjs'),
      'utf-8',
    );
    expect(staging).toContain("cargoTarget: 'x86_64-apple-darwin'");
    expect(staging).toContain("archKey: 'x64'");

    const electronBuilder = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf-8');
    expect(electronBuilder).toMatch(/type:\s*link\s*\n\s*path:\s*\/Applications/);
    expect(electronBuilder).toContain('IMPORTANT-Read-Me.txt');
    expect(electronBuilder).toContain('resources/macos/IMPORTANT-macOS-install.txt');

    const linuxVerify = readFileSync(
      join(REPO_ROOT, 'scripts', 'verify-linux-packaging.mjs'),
      'utf-8',
    );
    expect(linuxVerify).toContain('.AppImage');
    expect(linuxVerify).toContain('.deb');
    expect(linuxVerify).toContain('.rpm');

    for (const workflowName of ['build.yaml', 'release.yaml'] as const) {
      const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', workflowName), 'utf-8');
      expect(workflow).toContain('packaging-smoke:');
      expect(workflow).toContain('name: Smoke test ${{ matrix.label }}');
      expect(workflow).toContain('label: macOS packaging');
      expect(workflow).toContain('label: Linux packaging');
      expect(workflow).toContain('node scripts/verify-mac-packaging.mjs');
      expect(workflow).toContain('node scripts/verify-linux-packaging.mjs');
      expect(workflow).toContain('node scripts/test-linux-appimage-reticulum-sidecar.mjs');
      expect(workflow).toContain('verify-reticulum-sidecar-staged.mjs');
      expect(workflow).not.toContain('release/mac*/**/Mesh-client.app/**');
      expect(workflow).toMatch(/upload-artifact@v7[\s\S]*?symlinks/);
    }
  });

  it('enables macOS notarization and documents signing env vars in release workflow', () => {
    const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).toContain('notarize: true');
    expect(yml).not.toContain("identity: '-'");

    const releaseWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'release.yaml'),
      'utf-8',
    );
    expect(releaseWorkflow).toContain('CSC_LINK');
    expect(releaseWorkflow).toContain('APPLE_TEAM_ID');
    expect(releaseWorkflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY');
    expect(releaseWorkflow).toContain('Validate macOS signing secrets');
  });
});
