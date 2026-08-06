import { describe, expect, it } from 'vitest';

import {
  collectWinSetupInstallers,
  findWinSetupInstaller,
  matchWinSetupInstallerArch,
} from './win-setup-installer-names.mjs';

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
