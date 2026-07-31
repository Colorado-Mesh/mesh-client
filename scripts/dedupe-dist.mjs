#!/usr/bin/env node
/**
 * Dist packaging dedupe with retry on @jsr temp-dir rename races.
 *
 * Failure point: `pnpm dedupe` can hit ERR_PNPM_ENOENT renaming
 * `node_modules/@jsr/_tmp_*` → `@jsr/meshtastic__core` (and similar) even when
 * the lockfile is already fully deduped. Same root cause as Windows hoisted
 * install and Flatpak offline install.
 *
 * Fallback: clean stale `@jsr/_tmp_*` dirs and retry.
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { cleanJsrTempDirs } from './clean-jsr-temp-dirs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** Args passed to `pnpm` for dist dedupe (exported for contract tests). */
export const DEDUPE_DIST_ARGS = ['dedupe', '--config.ignore-scripts=true'];

export const DEDUPE_DIST_MAX_ATTEMPTS = 3;

/**
 * @param {{
 *   cwd?: string;
 *   maxAttempts?: number;
 *   spawnPnpm?: typeof spawnSync;
 *   cleanTemps?: (root: string) => void;
 * }} [opts]
 * @returns {number} process exit status
 * @throws {Error} when pnpm fails to launch (`spawnSync` `result.error`)
 */
export function runDedupeDist(opts = {}) {
  const cwd = opts.cwd ?? projectRoot;
  const maxAttempts = opts.maxAttempts ?? DEDUPE_DIST_MAX_ATTEMPTS;
  const spawnPnpm = opts.spawnPnpm ?? spawnSync;
  const cleanTemps = opts.cleanTemps ?? cleanJsrTempDirs;
  let lastStatus = 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      cleanTemps(path.join(cwd, 'node_modules'));
    }

    const result = spawnPnpm('pnpm', DEDUPE_DIST_ARGS, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (result.error) {
      console.error('[dedupe-dist] failed to spawn pnpm:', result.error);
      throw result.error;
    }
    lastStatus = result.status ?? 1;
    if (lastStatus === 0) {
      return 0;
    }
    if (attempt < maxAttempts) {
      console.warn(
        `[dedupe-dist] pnpm dedupe failed (attempt ${attempt}/${maxAttempts}), retrying…`,
      );
    }
  }

  return lastStatus;
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  process.exit(runDedupeDist());
}
