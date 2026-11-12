import fs, { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildMainProcess, parseEsbuildMainBuildArgs } from './esbuild-main-build.mjs';

/**
 * Live traffic pop-out window handlers add ~6.2 KiB. Direct `ip-address` was removed in favor
 * of `src/shared/ipLiteral.ts` (~33 KiB savings). Scheduled Broadcasts IPC/claim CAS adds ~9 KiB.
 * Internet weather (Open-Meteo / RainViewer / NEXRAD protocol + IPC) adds ~18 KiB.
 * Terrain LOS elevation (Open-Meteo sample + SRTM HGT offline DEM IPC) adds ~6 KiB
 * (HGT offset reader + clearance/bulge math follow-ups).
 * Catch up summary / follow-up prompt text ships as sibling `ai-summary-prompt.js` and
 * `ai-follow-up-prompt.js`; the offline model catalog as `ai-local-models.js`; OS AI / MLX
 * Metal ensure+spawn as `ai-native-runtime.js`; combined identity hydration SQL as
 * `identity-hydration.js` (not in index.js). Thin install-path checks stay in index.js for
 * sync status. Keep HF catalog / prompt / native runtime / identity hydration in siblings.
 * Fair MeshCore chat hydration SQL (`selectMeshcoreMessagesForHydration`) adds a small
 * window-function query so quiet group channels are not crowded out of the newest-N load.
 * Ratspeak 1.4 enablement (`attachments_json` on reticulum messages + IPC coalesce) nudged
 * the minified main past 797 KiB.
 * Local KML/KMZ/GeoJSON map overlay import (safe XML subset + KMZ mkdtemp extract) adds ~10 KiB.
 */
const MAIN_BUNDLE_SIZE_BUDGET_BYTES = 810 * 1024;

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
      const summaryPromptBytes = fs.readFileSync(path.join(tempDir, 'ai-summary-prompt.js'));
      expect(summaryPromptBytes.length).toBeGreaterThan(1_000);
      expect(summaryPromptBytes.toString('utf8')).toContain('buildAiSummaryPrompt');
      const followUpPromptBytes = fs.readFileSync(path.join(tempDir, 'ai-follow-up-prompt.js'));
      expect(followUpPromptBytes.length).toBeGreaterThan(1_000);
      expect(followUpPromptBytes.toString('utf8')).toContain('buildAiFollowUpPrompt');
      const localModelsBytes = fs.readFileSync(path.join(tempDir, 'ai-local-models.js'));
      expect(localModelsBytes.length).toBeGreaterThan(1_000);
      expect(localModelsBytes.toString('utf8')).toContain('AI_LOCAL_MODELS');
      const nativeRuntimeBytes = fs.readFileSync(path.join(tempDir, 'ai-native-runtime.js'));
      expect(nativeRuntimeBytes.length).toBeGreaterThan(1_000);
      expect(nativeRuntimeBytes.toString('utf8')).toContain('ensureMlxHelper');
      const identityHydrationBytes = fs.readFileSync(path.join(tempDir, 'identity-hydration.js'));
      expect(identityHydrationBytes.length).toBeGreaterThan(500);
      expect(identityHydrationBytes.toString('utf8')).toContain('readMeshtasticIdentityHydration');
      const teamRosterBytes = fs.readFileSync(path.join(tempDir, 'team-roster-handlers.js'));
      expect(teamRosterBytes.length).toBeGreaterThan(500);
      expect(teamRosterBytes.toString('utf8')).toContain('registerTeamRosterIpcHandlers');
      const teamRosterFallbackBytes = fs.readFileSync(
        path.join(tempDir, 'team-roster-handlers-fallback.js'),
      );
      expect(teamRosterFallbackBytes.length).toBeGreaterThan(200);
      expect(teamRosterFallbackBytes.toString('utf8')).toContain(
        'registerTeamRosterIpcFallbackHandlers',
      );
      const indexSource = fs.readFileSync(outfile, 'utf8');
      // Team roster DDL lives in the sibling chunk, not measured index.js.
      expect(indexSource).not.toContain('CREATE TABLE IF NOT EXISTS team_members');
      expect(teamRosterBytes.toString('utf8')).toContain('CREATE TABLE IF NOT EXISTS team_members');
      expect(indexSource).not.toContain('qwen2.5-1.5b-instruct-q4_k_m.gguf');
      expect(indexSource).not.toContain('Missing Metal Toolchain');
      expect(indexSource).not.toContain('discoverXcodeDeveloperDir');
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
