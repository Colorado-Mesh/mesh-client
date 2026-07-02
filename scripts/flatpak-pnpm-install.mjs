#!/usr/bin/env node
/**
 * Offline pnpm install for Flatpak builds with retry on @jsr temp-dir races.
 *
 * Failure point: pnpm install races renaming @jsr/_tmp_* during hoisted offline
 * install inside flatpak-builder sandbox. Fallback: clean stale temps and retry.
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { cleanJsrTempDirs } from './clean-jsr-temp-dirs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const STORE_DIR = '/run/build/mesh-client/flatpak-node/pnpm-store';
const maxAttempts = 3;

let lastStatus = 1;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  if (attempt > 1) {
    cleanJsrTempDirs(path.join(projectRoot, 'node_modules'));
  }

  const result = spawnSync(
    'pnpm',
    ['install', '--frozen-lockfile', '--offline', '--ignore-scripts', '--store-dir', STORE_DIR],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    },
  );
  lastStatus = result.status ?? 1;
  if (lastStatus === 0) {
    process.exit(0);
  }
  if (attempt < maxAttempts) {
    console.warn(
      `[flatpak-pnpm] pnpm install failed (attempt ${attempt}/${maxAttempts}), retrying…`,
    );
  }
}

process.exit(lastStatus);
