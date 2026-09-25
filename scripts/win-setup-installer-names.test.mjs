import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  collectWinSetupInstallers,
  findWinSetupInstaller,
  hyphenateWinSetupInstallerName,
  hyphenatedWinSetupNameFromGithubDotted,
  matchWinSetupInstallerArch,
  normalizeWinSetupInstallerNames,
} from './win-setup-installer-names.mjs';

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('matchWinSetupInstallerArch', () => {
  it('matches default and stamped names', () => {
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client Setup 5.26.0.exe')).toBe('x64');
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client Setup 5.26.0-arm64.exe')).toBe(
      'arm64',
    );
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client Setup 5.26.0-run214.exe')).toBe('x64');
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client Setup 5.26.0-run214-arm64.exe')).toBe(
      'arm64',
    );
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client-Setup-5.26.0.exe')).toBe('x64');
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client-Setup-5.26.0-arm64.exe')).toBe(
      'arm64',
    );
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client-Setup-5.26.0-run214.exe')).toBe('x64');
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client-Setup-5.26.0-run214-arm64.exe')).toBe(
      'arm64',
    );
  });

  it('rejects wrong version and non-setup exes', () => {
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client Setup 5.25.0.exe')).toBeNull();
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client.exe')).toBeNull();
    expect(matchWinSetupInstallerArch('5.26.0', 'Mesh-client Setup 5.26.0__uninstaller.exe')).toBe(
      null,
    );
  });
});

describe('collectWinSetupInstallers', () => {
  it('collects hyphenated pair', () => {
    expect(
      collectWinSetupInstallers('5.26.0', [
        'Mesh-client-Setup-5.26.0.exe',
        'Mesh-client-Setup-5.26.0-arm64.exe',
      ]),
    ).toEqual({
      x64: 'Mesh-client-Setup-5.26.0.exe',
      arm64: 'Mesh-client-Setup-5.26.0-arm64.exe',
    });
  });

  it('collects default pair', () => {
    expect(
      collectWinSetupInstallers('5.26.0', [
        'Mesh-client Setup 5.26.0.exe',
        'Mesh-client Setup 5.26.0-arm64.exe',
        'READ-ME-FIRST-test-build.md',
      ]),
    ).toEqual({
      x64: 'Mesh-client Setup 5.26.0.exe',
      arm64: 'Mesh-client Setup 5.26.0-arm64.exe',
    });
  });

  it('collects stamped pair', () => {
    expect(
      collectWinSetupInstallers('5.26.0', [
        'Mesh-client Setup 5.26.0-run214.exe',
        'Mesh-client Setup 5.26.0-run214-arm64.exe',
      ]),
    ).toEqual({
      x64: 'Mesh-client Setup 5.26.0-run214.exe',
      arm64: 'Mesh-client Setup 5.26.0-run214-arm64.exe',
    });
  });

  it('rejects duplicates', () => {
    expect(() =>
      collectWinSetupInstallers('5.26.0', [
        'Mesh-client Setup 5.26.0.exe',
        'Mesh-client Setup 5.26.0-run214.exe',
        'Mesh-client Setup 5.26.0-arm64.exe',
      ]),
    ).toThrow(/exactly one x64/);
  });
});

describe('findWinSetupInstaller', () => {
  it('finds stamped arch', () => {
    expect(
      findWinSetupInstaller('5.26.0', 'arm64', [
        'Mesh-client Setup 5.26.0-run9.exe',
        'Mesh-client Setup 5.26.0-run9-arm64.exe',
      ]),
    ).toBe('Mesh-client Setup 5.26.0-run9-arm64.exe');
  });
});

describe('hyphenateWinSetupInstallerName', () => {
  it('replaces spaces with hyphens', () => {
    expect(hyphenateWinSetupInstallerName('Mesh-client Setup 5.36.0.exe')).toBe(
      'Mesh-client-Setup-5.36.0.exe',
    );
    expect(hyphenateWinSetupInstallerName('Mesh-client-Setup-5.36.0.exe')).toBe(
      'Mesh-client-Setup-5.36.0.exe',
    );
  });
});

describe('hyphenatedWinSetupNameFromGithubDotted', () => {
  it('maps GitHub dotted Setup names to latest.yml urls', () => {
    expect(hyphenatedWinSetupNameFromGithubDotted('Mesh-client.Setup.5.36.0.exe')).toBe(
      'Mesh-client-Setup-5.36.0.exe',
    );
    expect(hyphenatedWinSetupNameFromGithubDotted('Mesh-client.Setup.5.36.0-arm64.exe')).toBe(
      'Mesh-client-Setup-5.36.0-arm64.exe',
    );
    expect(hyphenatedWinSetupNameFromGithubDotted('Mesh-client-Setup-5.36.0.exe')).toBeNull();
  });
});

describe('normalizeWinSetupInstallerNames', () => {
  it('renames spaced Setup exes in a directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'normalize-win-setup-'));
    tempDirs.push(root);
    fs.writeFileSync(path.join(root, 'Mesh-client Setup 5.36.0.exe'), 'x');
    fs.writeFileSync(path.join(root, 'Mesh-client Setup 5.36.0-arm64.exe'), 'x');
    const result = normalizeWinSetupInstallerNames(root);
    expect(result.renamed).toHaveLength(2);
    expect(fs.existsSync(path.join(root, 'Mesh-client-Setup-5.36.0.exe'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'Mesh-client-Setup-5.36.0-arm64.exe'))).toBe(true);
  });
});
