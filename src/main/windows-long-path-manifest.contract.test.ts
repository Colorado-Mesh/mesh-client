// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');

describe('Windows long-path application manifest (packaging contract)', () => {
  it('wires electron-builder afterPack and embeds longPathAware in the manifest resource', () => {
    const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).toContain('afterPack: scripts/electron-builder-after-pack.cjs');

    const hook = readFileSync(
      join(REPO_ROOT, 'scripts', 'electron-builder-after-pack.cjs'),
      'utf-8',
    );
    expect(hook).toContain('resedit');
    expect(hook).toMatch(/RT_MANIFEST_TYPE|type === 24/);
    expect(hook).toContain('mesh-client-long-path.manifest.xml');
    expect(hook).toContain('renameSync');
    expect(hook).toMatch(/\.tmp['"`]/);

    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      devDependencies?: Record<string, string>;
    };
    expect(packageJson.devDependencies?.rcedit).toBeUndefined();
    expect(packageJson.devDependencies?.resedit).toMatch(/^[\^~]?1\.7/);

    const manifest = readFileSync(
      join(REPO_ROOT, 'resources', 'win', 'mesh-client-long-path.manifest.xml'),
      'utf-8',
    );
    expect(manifest).toContain('urn:schemas-microsoft-com:asm.v3');
    expect(manifest).toContain('http://schemas.microsoft.com/SMI/2016/WindowsSettings');
    expect(manifest).toMatch(/ws2:longPathAware>true</);
  });

  it('declares readable-stream as a direct production dep with pnpm patch for asar packaging', () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      pnpm?: { patchedDependencies?: Record<string, string> };
    };
    const lockfile = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf-8');
    expect(packageJson.dependencies?.['readable-stream']).toMatch(/^[\^~]?4\./);

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
    expect(lockfile).toMatch(/'@electron\/asar': [\^~]?4\.\d+/);
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

  it('disables universal NSIS and verifies split Windows installers after dist:win', () => {
    const yml = readFileSync(join(REPO_ROOT, 'electron-builder.yml'), 'utf-8');
    expect(yml).toMatch(/nsis:\s*\n\s*buildUniversalInstaller:\s*false/);

    const verifyScript = readFileSync(
      join(REPO_ROOT, 'scripts', 'verify-win-packaging.mjs'),
      'utf-8',
    );
    expect(verifyScript).toContain('win-arm64-unpacked');
    expect(verifyScript).toContain('-arm64.exe');
    expect(verifyScript).toContain('NtExecutable.from');
  });

  it('keeps dist:win build and release workflows bound to windows-latest', () => {
    const buildWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'build.yaml'),
      'utf-8',
    );
    expect(buildWorkflow).toMatch(/- os: windows-latest\s+build_script: pnpm run dist:win/);
    expect(buildWorkflow).toContain(
      "contains(matrix.build_script, 'dist:win') && matrix.os != 'windows-latest'",
    );

    const releaseWorkflow = readFileSync(
      join(REPO_ROOT, '.github', 'workflows', 'release.yaml'),
      'utf-8',
    );
    expect(releaseWorkflow).toMatch(
      /- os: windows-latest\s+build_script: pnpm run dist:win:publish/,
    );
    expect(releaseWorkflow).toContain(
      "contains(matrix.build_script, 'dist:win') && matrix.os != 'windows-latest'",
    );
  });
});
