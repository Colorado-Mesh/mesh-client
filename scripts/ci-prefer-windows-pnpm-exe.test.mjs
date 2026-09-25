// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverWindowsPnpmExes,
  preferWindowsPnpmExe,
  resolvePnpmExeFromCmdShim,
  selectWindowsPnpmExe,
  windowsPnpmExeCandidates,
} from './ci-prefer-windows-pnpm-exe.mjs';
import { parsePnpmVersionOutput, verifyPnpmVersion } from './ci-verify-pnpm.mjs';
import { assertWinSetupInstallers } from './assert-win-setup-installers.mjs';

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ci-prefer-windows-pnpm-exe', () => {
  it('lists PNPM_HOME and self-update candidates before the bootstrap sibling', () => {
    const home = path.join('C:', 'setup-pnpm', 'node_modules', '.bin');
    expect(windowsPnpmExeCandidates(home)).toEqual([
      path.join(home, 'pnpm.exe'),
      path.join(home, 'bin', 'pnpm.exe'),
      path.resolve(home, '..', 'pnpm', 'pnpm.exe'),
    ]);
  });

  it('skips on non-Windows', () => {
    const result = preferWindowsPnpmExe({
      platform: 'darwin',
      pnpmHome: '/tmp/pnpm',
      githubPath: '/tmp/github_path',
    });
    expect(result).toEqual({ skipped: true, reason: 'not-win32' });
  });

  it('resolves pnpm.exe from a self-update %~dp0 cmd shim', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-pnpm-cmd-'));
    tempDirs.push(root);
    const bin = path.join(root, 'node_modules', '.bin');
    const hashDir = path.join(bin, 'global', 'v11', '22b0-deadbeef');
    const exeDir = path.join(hashDir, 'node_modules', '@pnpm', 'exe');
    fs.mkdirSync(exeDir, { recursive: true });
    const exe = path.join(exeDir, 'pnpm.exe');
    fs.writeFileSync(exe, '');
    const cmdPath = path.join(bin, 'pnpm.cmd');
    // action-setup sets PNPM_HOME to node_modules/.bin; self-update keeps global/ under it.
    fs.writeFileSync(
      cmdPath,
      `@SETLOCAL\r\n@"%~dp0global\\v11\\22b0-deadbeef\\node_modules\\@pnpm\\exe\\pnpm" %*\r\n`,
    );

    expect(resolvePnpmExeFromCmdShim(cmdPath)).toBe(exe);
    expect(discoverWindowsPnpmExes(bin)).toContain(exe);
  });

  it('prefers the packageManager-matching exe over a stale bootstrap sibling', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-pnpm-path-'));
    tempDirs.push(root);
    const bin = path.join(root, 'node_modules', '.bin');
    const stalePkg = path.join(root, 'node_modules', 'pnpm');
    const freshDir = path.join(bin, 'global', 'v11', 'abcd-1234', 'node_modules', 'pnpm');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(stalePkg, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });
    const staleExe = path.join(stalePkg, 'pnpm.exe');
    const freshExe = path.join(freshDir, 'pnpm.exe');
    fs.writeFileSync(staleExe, '');
    fs.writeFileSync(freshExe, '');
    const githubPath = path.join(root, 'github_path');
    fs.writeFileSync(githubPath, '');
    const packageJsonPath = path.join(root, 'package.json');
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ packageManager: 'pnpm@12.4.2+sha512.deadbeef' }),
    );

    /** @type {string[]} */
    const logs = [];
    const result = preferWindowsPnpmExe({
      platform: 'win32',
      pnpmHome: bin,
      githubPath,
      packageJsonPath,
      spawnSyncFn: (cmd) => {
        if (cmd === freshExe)
          return { status: 0, stdout: '12.4.2\n', stderr: '', error: undefined };
        if (cmd === staleExe)
          return { status: 0, stdout: '12.3.4\n', stderr: '', error: undefined };
        return { status: 1, stdout: '', stderr: 'missing', error: undefined };
      },
      log: (msg) => logs.push(msg),
    });

    expect(result.skipped).toBe(false);
    expect(result.exe).toBe(freshExe);
    expect(result.version).toBe('12.4.2');
    expect(result.exeDir).toBe(freshDir);
    expect(fs.readFileSync(githubPath, 'utf8')).toBe(`${freshDir}\n`);
    expect(logs[0]).toContain(freshDir);
    expect(logs[0]).toContain('12.4.2');
  });

  it('fails when a version-mismatched bootstrap has no pinned PNPM_HOME cmd shim', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-pnpm-mismatch-'));
    tempDirs.push(root);
    const bin = path.join(root, 'node_modules', '.bin');
    const stalePkg = path.join(root, 'node_modules', 'pnpm');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(stalePkg, { recursive: true });
    const staleExe = path.join(stalePkg, 'pnpm.exe');
    fs.writeFileSync(staleExe, '');
    const ps1 = path.join(bin, 'pnpm.ps1');
    fs.writeFileSync(ps1, 'exit 0');
    const githubPath = path.join(root, 'github_path');
    fs.writeFileSync(githubPath, '');
    const packageJsonPath = path.join(root, 'package.json');
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ packageManager: 'pnpm@12.4.2+sha512.deadbeef' }),
    );

    expect(() =>
      preferWindowsPnpmExe({
        platform: 'win32',
        pnpmHome: bin,
        githubPath,
        packageJsonPath,
        spawnSyncFn: (cmd) => {
          if (cmd === staleExe) {
            return { status: 0, stdout: '12.3.4\n', stderr: '', error: undefined };
          }
          return { status: 1, stdout: '', stderr: '', error: undefined };
        },
        log: () => {},
      }),
    ).toThrow(/no PNPM_HOME\/\.cmd shim matches packageManager 12\.4\.2/);

    expect(fs.existsSync(ps1)).toBe(false);
    expect(fs.readFileSync(githubPath, 'utf8')).toBe('');
  });

  it('skips a stale bootstrap when a PNPM_HOME cmd shim reports the packageManager pin', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-pnpm-shim-ok-'));
    tempDirs.push(root);
    const bin = path.join(root, 'node_modules', '.bin');
    const stalePkg = path.join(root, 'node_modules', 'pnpm');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(stalePkg, { recursive: true });
    const staleExe = path.join(stalePkg, 'pnpm.exe');
    fs.writeFileSync(staleExe, '');
    const cmdShim = path.join(bin, 'pnpm.cmd');
    fs.writeFileSync(cmdShim, '@echo 12.4.2\r\n');
    const ps1 = path.join(bin, 'pnpm.ps1');
    fs.writeFileSync(ps1, 'exit 0');
    const githubPath = path.join(root, 'github_path');
    fs.writeFileSync(githubPath, '');
    const packageJsonPath = path.join(root, 'package.json');
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ packageManager: 'pnpm@12.4.2+sha512.deadbeef' }),
    );

    /** @type {string[]} */
    const logs = [];
    const result = preferWindowsPnpmExe({
      platform: 'win32',
      pnpmHome: bin,
      githubPath,
      packageJsonPath,
      spawnSyncFn: (cmd) => {
        if (cmd === staleExe) {
          return { status: 0, stdout: '12.3.4\n', stderr: '', error: undefined };
        }
        if (cmd === cmdShim) {
          return { status: 0, stdout: '12.4.2\n', stderr: '', error: undefined };
        }
        return { status: 1, stdout: '', stderr: '', error: undefined };
      },
      log: (msg) => logs.push(msg),
    });

    expect(result.reason).toBe('stale-bootstrap-skipped');
    expect(result.exeDir).toBe(bin);
    expect(result.version).toBe('12.4.2');
    expect(fs.existsSync(ps1)).toBe(false);
    expect(fs.readFileSync(githubPath, 'utf8')).toBe(`${bin}\n`);
    expect(logs.some((l) => l.includes('skipped stale') && l.includes(cmdShim))).toBe(true);
  });

  it('selects the pinned version when multiple exes probe successfully', () => {
    const selected = selectWindowsPnpmExe(
      ['C:\\stale\\pnpm.exe', 'C:\\fresh\\pnpm.exe'],
      '12.4.2',
      (cmd) => {
        if (String(cmd).includes('stale')) {
          return { status: 0, stdout: '12.3.4\n', stderr: '', error: undefined };
        }
        return { status: 0, stdout: '12.4.2\n', stderr: '', error: undefined };
      },
    );
    expect(selected).toEqual({ exe: 'C:\\fresh\\pnpm.exe', version: '12.4.2' });
  });

  it('removes broken PowerShell shims under PNPM_HOME after selecting an exe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-pnpm-ps1-'));
    tempDirs.push(root);
    const bin = path.join(root, 'node_modules', '.bin');
    const pkg = path.join(root, 'node_modules', 'pnpm');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(pkg, { recursive: true });
    const exe = path.join(pkg, 'pnpm.exe');
    fs.writeFileSync(exe, '');
    const ps1 = path.join(bin, 'pnpm.ps1');
    fs.writeFileSync(ps1, 'exit 0');
    const githubPath = path.join(root, 'github_path');
    fs.writeFileSync(githubPath, '');
    const packageJsonPath = path.join(root, 'package.json');
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ packageManager: 'pnpm@12.4.2+sha512.deadbeef' }),
    );

    preferWindowsPnpmExe({
      platform: 'win32',
      pnpmHome: bin,
      githubPath,
      packageJsonPath,
      spawnSyncFn: () => ({ status: 0, stdout: '12.4.2\n', stderr: '', error: undefined }),
      log: () => {},
    });

    expect(fs.existsSync(ps1)).toBe(false);
  });

  it('fails when pnpm.exe is missing', () => {
    expect(() =>
      preferWindowsPnpmExe({
        platform: 'win32',
        pnpmHome: path.join('C:', 'missing', '.bin'),
        githubPath: path.join('C:', 'github_path'),
        existsSync: () => false,
        appendFileSync: () => {},
      }),
    ).toThrow(/pnpm\.exe not found/);
  });
});

describe('ci-verify-pnpm', () => {
  it('parses plain semver stdout', () => {
    expect(parsePnpmVersionOutput('12.3.4\n')).toBe('12.3.4');
    expect(parsePnpmVersionOutput('')).toBeNull();
    expect(parsePnpmVersionOutput('not-a-version')).toBeNull();
  });

  it('accepts matching major and rejects empty or wrong-major output', () => {
    const packageJsonPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-verify-pnpm-')),
      'package.json',
    );
    tempDirs.push(path.dirname(packageJsonPath));
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify({ packageManager: 'pnpm@12.3.4+sha512.deadbeef' }),
    );

    expect(
      verifyPnpmVersion({
        packageJsonPath,
        spawnSyncFn: () => ({ status: 0, stdout: '12.9.0\n', stderr: '', error: undefined }),
        log: () => {},
      }),
    ).toBe('12.9.0');

    expect(() =>
      verifyPnpmVersion({
        packageJsonPath,
        spawnSyncFn: () => ({ status: 0, stdout: '', stderr: '', error: undefined }),
        log: () => {},
      }),
    ).toThrow(/did not return semver/);

    expect(() =>
      verifyPnpmVersion({
        packageJsonPath,
        spawnSyncFn: () => ({ status: 0, stdout: '11.25.0\n', stderr: '', error: undefined }),
        log: () => {},
      }),
    ).toThrow(/major mismatch/);
  });
});

describe('assert-win-setup-installers', () => {
  it('accepts stamped split installers and rejects README-only release dirs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-assert-win-'));
    tempDirs.push(root);
    const packageJsonPath = path.join(root, 'package.json');
    fs.writeFileSync(packageJsonPath, JSON.stringify({ version: '5.35.0' }));
    const releaseDir = path.join(root, 'release');
    fs.mkdirSync(releaseDir);
    fs.writeFileSync(path.join(releaseDir, 'READ-ME-FIRST-test-build.md'), 'x');

    expect(() => assertWinSetupInstallers({ rootDir: releaseDir, packageJsonPath })).toThrow(
      /Expected exactly one x64 NSIS installer/,
    );

    fs.writeFileSync(path.join(releaseDir, 'Mesh-client Setup 5.35.0-run281.exe'), '');
    fs.writeFileSync(path.join(releaseDir, 'Mesh-client Setup 5.35.0-run281-arm64.exe'), '');
    expect(assertWinSetupInstallers({ rootDir: releaseDir, packageJsonPath })).toEqual({
      x64: 'Mesh-client Setup 5.35.0-run281.exe',
      arm64: 'Mesh-client Setup 5.35.0-run281-arm64.exe',
    });
  });
});
