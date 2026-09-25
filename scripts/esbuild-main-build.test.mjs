import fs, { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildMainProcess, parseEsbuildMainBuildArgs } from './esbuild-main-build.mjs';

/** Keep the minified main outfile under esbuild's 1mb advisory (and well below). */
const MAIN_BUNDLE_SIZE_BUDGET_BYTES = 512 * 1024;

describe('esbuild-main-build', () => {
  /** @type {string | null} */
  let tempDir = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('parses minify and metafile flags', () => {
    expect(parseEsbuildMainBuildArgs(['--minify'])).toEqual({
      minify: true,
      metafilePath: null,
    });
    expect(parseEsbuildMainBuildArgs(['--metafile=dist-electron/main/metafile.json'])).toEqual({
      minify: false,
      metafilePath: 'dist-electron/main/metafile.json',
    });
    expect(
      parseEsbuildMainBuildArgs(['--minify', '--metafile=dist-electron/main/meta.json']),
    ).toEqual({
      minify: true,
      metafilePath: 'dist-electron/main/meta.json',
    });
  });

  it('rejects unknown CLI flags', () => {
    expect(() => parseEsbuildMainBuildArgs(['--watch'])).toThrow(/Unknown/);
  });

  it('uses the esbuild JS API instead of spawning bin/esbuild (Windows shim)', () => {
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'esbuild-main-build.mjs'),
      'utf8',
    );
    // Regression: spawnSync(require.resolve('esbuild/bin/esbuild')) fails on win32 where
    // postinstall leaves bin/esbuild as a Node shim (maybeOptimizePackage skips win32).
    expect(src).toContain("from 'esbuild'");
    expect(src).toMatch(/\besbuild\.build\s*\(/);
    expect(src).not.toMatch(/\bspawnSync\s*\(/);
    expect(src).not.toContain("require.resolve('esbuild/bin/esbuild')");
    expect(src).not.toMatch(/\bchild_process\b/);
  });

  it(
    'keeps the minified main bundle under the size budget (undici/ws external)',
    { timeout: 60_000 },
    async () => {
      tempDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-main-bundle-'));
      const outfile = path.join(tempDir, 'index.js');
      await buildMainProcess({ minify: true, outfile });
      const { size } = fs.statSync(outfile);
      expect(size).toBeGreaterThan(100_000);
      expect(size).toBeLessThan(MAIN_BUNDLE_SIZE_BUDGET_BYTES);
    },
  );
});
