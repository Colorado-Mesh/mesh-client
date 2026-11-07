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

  it('treats Xcode.app with Developer (no on-disk metal stub) as ready', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    const developer = path.join(root, 'Xcode.app', 'Contents', 'Developer');
    mkdirSync(path.join(developer, 'usr', 'bin'), { recursive: true });
    // Modern Xcode often has no usr/bin/metal stub; Metal is via xcrun cryptex.
    expect(discoverXcodeDeveloperDir(root)).toBe(developer);
    expect(classifyXcodeDeveloperDir(root)).toBe('ready');
  });

  it('reports incomplete when Xcode.app exists without Contents/Developer', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    mkdirSync(path.join(root, 'Xcode.app', 'Contents'), { recursive: true });
    expect(discoverXcodeDeveloperDir(root)).toBeNull();
    expect(classifyXcodeDeveloperDir(root)).toBe('xcodeIncomplete');
  });

  it('finds Xcode.app Contents/Developer', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    const developer = path.join(root, 'Xcode.app', 'Contents', 'Developer');
    mkdirSync(developer, { recursive: true });
    writeFileSync(path.join(developer, '.keep'), '');
    expect(discoverXcodeDeveloperDir(root)).toBe(developer);
    expect(classifyXcodeDeveloperDir(root)).toBe('ready');
  });

  it('finds alternate Xcode-beta.app when primary has no Developer', () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-xcode-'));
    mkdirSync(path.join(root, 'Xcode.app', 'Contents'), { recursive: true });
    const betaDeveloper = path.join(root, 'Xcode-beta.app', 'Contents', 'Developer');
    mkdirSync(betaDeveloper, { recursive: true });
    expect(discoverXcodeDeveloperDir(root)).toBe(betaDeveloper);
  });
});
