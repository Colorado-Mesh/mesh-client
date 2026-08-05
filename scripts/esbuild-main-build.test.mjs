import { describe, expect, it } from 'vitest';

import { parseEsbuildMainBuildArgs } from './esbuild-main-build.mjs';

describe('esbuild-main-build', () => {
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

  it('uses the esbuild JS API instead of spawning bin/esbuild (Windows shim)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
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
});
