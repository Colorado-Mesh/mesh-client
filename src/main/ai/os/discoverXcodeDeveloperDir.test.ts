import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { classifyXcodeDeveloperDir, discoverXcodeDeveloperDir } from './discoverXcodeDeveloperDir';

describe('discoverXcodeDeveloperDir', () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when Applications has no Xcode.app', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    expect(discoverXcodeDeveloperDir(root)).toBeNull();
    expect(classifyXcodeDeveloperDir(root)).toBe('xcodeNotFound');
  });

  it('ignores Xcode.app without metal and reports incomplete', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    mkdirSync(path.join(root, 'Xcode.app', 'Contents', 'Developer', 'usr', 'bin'), {
      recursive: true,
    });
    expect(discoverXcodeDeveloperDir(root)).toBeNull();
    expect(classifyXcodeDeveloperDir(root)).toBe('xcodeIncomplete');
  });

  it('finds Xcode.app with metal under Contents/Developer', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    const metalDir = path.join(root, 'Xcode.app', 'Contents', 'Developer', 'usr', 'bin');
    mkdirSync(metalDir, { recursive: true });
    writeFileSync(path.join(metalDir, 'metal'), '');
    const developer = path.join(root, 'Xcode.app', 'Contents', 'Developer');
    expect(discoverXcodeDeveloperDir(root)).toBe(developer);
    expect(classifyXcodeDeveloperDir(root)).toBe('ready');
  });

  it('finds alternate Xcode-beta.app when primary is missing metal', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    mkdirSync(path.join(root, 'Xcode.app', 'Contents', 'Developer'), { recursive: true });
    const betaMetal = path.join(root, 'Xcode-beta.app', 'Contents', 'Developer', 'usr', 'bin');
    mkdirSync(betaMetal, { recursive: true });
    writeFileSync(path.join(betaMetal, 'metal'), '');
    expect(discoverXcodeDeveloperDir(root)).toBe(
      path.join(root, 'Xcode-beta.app', 'Contents', 'Developer'),
    );
  });
});
