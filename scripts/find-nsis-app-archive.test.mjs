// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import { findAppArchive } from './find-nsis-app-archive.mjs';

describe('findAppArchive', () => {
  /** @type {string[]} */
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTemp() {
    const dir = mkdtempSync(path.join(tmpdir(), 'nsis-probe-'));
    tempDirs.push(dir);
    return dir;
  }

  it('returns null when no payload archives exist', () => {
    const root = makeTemp();
    mkdirSync(path.join(root, '$PLUGINSDIR'));
    expect(findAppArchive(root)).toBeNull();
  });

  it('finds app-arm64.zip nested under $PLUGINSDIR', () => {
    const root = makeTemp();
    const pluginsDir = path.join(root, '$PLUGINSDIR');
    mkdirSync(pluginsDir, { recursive: true });
    const archive = path.join(pluginsDir, 'app-arm64.zip');
    writeFileSync(archive, 'fake');

    expect(findAppArchive(root)).toBe(archive);
  });

  it('finds app-arm64.7z nested under $PLUGINSDIR', () => {
    const root = makeTemp();
    const pluginsDir = path.join(root, '$PLUGINSDIR');
    mkdirSync(pluginsDir, { recursive: true });
    const archive = path.join(pluginsDir, 'app-arm64.7z');
    writeFileSync(archive, 'fake');

    expect(findAppArchive(root)).toBe(archive);
  });

  it('prefers app*.7z over other archives', () => {
    const root = makeTemp();
    const pluginsDir = path.join(root, '$PLUGINSDIR');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(path.join(pluginsDir, 'other.7z'), 'fake');
    const appArchive = path.join(pluginsDir, 'app-64.7z');
    writeFileSync(appArchive, 'fake');

    expect(findAppArchive(root)).toBe(appArchive);
  });

  it('prefers $PLUGINSDIR when app archives exist in multiple dirs', () => {
    const root = makeTemp();
    const pluginsDir = path.join(root, '$PLUGINSDIR');
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(path.join(root, '$R0'), { recursive: true });
    const inPlugins = path.join(pluginsDir, 'app-arm64.7z');
    writeFileSync(inPlugins, 'fake');
    writeFileSync(path.join(root, '$R0', 'app-arm64.7z'), 'fake');

    expect(findAppArchive(root)).toBe(inPlugins);
  });
});
