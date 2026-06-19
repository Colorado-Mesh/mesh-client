// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

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
      pnpm?: { patchedDependencies?: Record<string, string> };
    };
    const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf-8');
    expect(packageJson.dependencies?.['readable-stream']).toMatch(/^[~^]?4\./);

    const readableStreamLockRe = /^ {2}readable-stream@(4\.\d+\.\d+):$/m;
    const resolvedMatch = readableStreamLockRe.exec(lockfile);
    expect(resolvedMatch).not.toBeNull();
    const resolvedVersion = resolvedMatch![1];
    expect(packageJson.pnpm?.patchedDependencies?.[`readable-stream@${resolvedVersion}`]).toBe(
      `patches/readable-stream@${resolvedVersion}.patch`,
    );
  });

  it('keeps the @electron/asar pnpm override on v4 or newer for Windows packaging', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      pnpm?: { overrides?: Record<string, string> };
    };
    const override = packageJson.pnpm?.overrides?.['@electron/asar'];
    expect(override).toBeDefined();

    const major = Number(override?.replace(/^[^\d]*/, '').split('.')[0]);
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
    expect(yml).toMatch(/nsis:\s*\n\s*buildUniversalInstaller:\s*false/);
    expect(yml).toContain('include: resources/installer.nsh');

    const installerNsh = readFileSync(join(REPO_ROOT, 'resources', 'installer.nsh'), 'utf-8');
    expect(installerNsh).toContain('Mesh-client.exe');
    expect(installerNsh).toContain('customFinish');

    const verifyScript = readFileSync(
      join(REPO_ROOT, 'scripts', 'verify-win-packaging.mjs'),
      'utf-8',
    );
    expect(verifyScript).toContain('win-arm64-unpacked');
    expect(verifyScript).toContain('-arm64.exe');
    expect(verifyScript).not.toContain('resedit');
  });

  it('pins electron-builder to 26.15.4 or newer', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      devDependencies?: Record<string, string>;
    };
    const version = packageJson.devDependencies?.['electron-builder']?.replace(/^[^\d]*/, '');
    expect(version).toBeDefined();
    const [major, minor, patch] = version!.split('.').map(Number);
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
    expect(installScript).toContain('/LOG=');
    expect(installScript).toContain('find-nsis-app-archive.mjs');

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
    // Matrix entry: `os` on its own line; `build_script` indented on the next line.
    expect(buildWorkflow).toMatch(/- os: windows-latest\s*\n\s+build_script: pnpm run dist:win/);
    expect(buildWorkflow).toContain(
      "contains(matrix.build_script, 'dist:win') && matrix.os != 'windows-latest'",
    );
    expect(buildWorkflow).toContain('node scripts/test-win-nsis-install.mjs --arch x64');
    expect(buildWorkflow).toContain('Smoke test macOS packaging');
    expect(buildWorkflow).toContain('Smoke test Linux packaging');
    expect(buildWorkflow).toContain('win-arm64-install:');
    expect(buildWorkflow).toContain('runs-on: windows-11-arm');
    expect(buildWorkflow).toContain(
      'node scripts/test-win-nsis-install.mjs --arch arm64 --probe-7z',
    );

    const releaseWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'release.yaml'),
      'utf-8',
    );
    // Matrix entry: `os` on its own line; `build_script` indented on the next line.
    expect(releaseWorkflow).toMatch(
      /- os: windows-latest\s*\n\s+build_script: pnpm run dist:win:publish/,
    );
    expect(releaseWorkflow).toContain(
      "contains(matrix.build_script, 'dist:win') && matrix.os != 'windows-latest'",
    );
    expect(releaseWorkflow).toContain('node scripts/test-win-nsis-install.mjs --arch x64');
    expect(releaseWorkflow).toContain('win-arm64-install:');
    expect(releaseWorkflow).toContain('runs-on: windows-11-arm');
    expect(releaseWorkflow).toContain(
      'node scripts/test-win-nsis-install.mjs --arch arm64 --probe-7z',
    );
  });

  it('runs macOS and Linux packaging smoke tests in dist scripts and CI workflows', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    for (const scriptName of ['dist:mac', 'dist:mac:publish'] as const) {
      const script = packageJson.scripts?.[scriptName];
      expect(script, scriptName).toBeDefined();
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

    const linuxVerify = readFileSync(
      join(REPO_ROOT, 'scripts', 'verify-linux-packaging.mjs'),
      'utf-8',
    );
    expect(linuxVerify).toContain('.AppImage');
    expect(linuxVerify).toContain('.deb');
    expect(linuxVerify).toContain('.rpm');

    for (const workflowName of ['build.yaml', 'release.yaml'] as const) {
      const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', workflowName), 'utf-8');
      expect(workflow).toContain('Smoke test macOS packaging');
      expect(workflow).toContain('node scripts/verify-mac-packaging.mjs');
      expect(workflow).toContain('Smoke test Linux packaging');
      expect(workflow).toContain('node scripts/verify-linux-packaging.mjs');
    }
  });
});
