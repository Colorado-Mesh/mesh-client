import fs, { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildMainProcess, parseEsbuildMainBuildArgs } from './esbuild-main-build.mjs';

/** Close-to-tray connection flags and pinned Catch up lookups bring main to ~731.3 KiB. */
const MAIN_BUNDLE_SIZE_BUDGET_BYTES = 732 * 1024;

function expectMainBundleSize(outfile) {
  const { size } = fs.statSync(outfile);
  expect(size).toBeGreaterThan(100_000);
  expect(size).toBeLessThan(MAIN_BUNDLE_SIZE_BUDGET_BYTES);
}

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

  it.each([
    [100_001, true],
    [MAIN_BUNDLE_SIZE_BUDGET_BYTES - 1, true],
    [MAIN_BUNDLE_SIZE_BUDGET_BYTES, false],
    [MAIN_BUNDLE_SIZE_BUDGET_BYTES + 1, false],
    [752_883, false],
    [0, false],
    [100_000, false],
  ])('enforces the strict budget for a %i-byte fixture (accepted: %s)', (bytes, accepted) => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'mesh-main-budget-'));
    const outfile = path.join(tempDir, 'index.js');
    fs.writeFileSync(outfile, Buffer.alloc(bytes));
    if (accepted) expectMainBundleSize(outfile);
    else expect(() => expectMainBundleSize(outfile)).toThrow();
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
      const worker = path.join(tempDir, 'translation-worker.js');
      const workerBytes = fs.readFileSync(worker);
      expect(workerBytes.length).toBeGreaterThan(10_000);
      expect(workerBytes.toString('utf8')).not.toContain('https://firefox-settings-attachments');
      const noticeDirectory = path.join(tempDir, 'translation-licenses');
      expect(fs.readFileSync(path.join(noticeDirectory, 'LICENSE-fastText.txt'), 'utf8')).toContain(
        'Copyright (c) 2016-present, Facebook, Inc.',
      );
      expect(fs.readFileSync(path.join(noticeDirectory, 'LICENSE-fastText.txt'), 'utf8')).toContain(
        'Permission is hereby granted',
      );
      expect(fs.readFileSync(path.join(noticeDirectory, 'LICENSE-MPL-2.0.txt'), 'utf8')).toContain(
        'Mozilla Public License Version 2.0',
      );
      expect(fs.readFileSync(path.join(noticeDirectory, 'README.md'), 'utf8')).toContain(
        '48d55cf7ec80093903e2ef7f58b61a84a22ef716',
      );
      for (const notice of ['LICENSE-wllama.txt', 'LICENSE-llama-cpp.txt'])
        expect(fs.readFileSync(path.join(tempDir, 'ai-licenses', notice), 'utf8')).toContain(
          'Permission is hereby granted',
        );
      expectMainBundleSize(outfile);
    },
  );
});
