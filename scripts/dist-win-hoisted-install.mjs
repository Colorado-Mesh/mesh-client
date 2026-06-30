#!/usr/bin/env node
/**
 * Before electron-builder on Windows, ensure hoisted node_modules layout.
 *
 * Failure point: pnpm install races on Windows (ENOENT/ENOTEMPTY renaming @jsr
 * temp dirs under nested node_modules). Fallback: skip in CI — the workflow
 * already runs frozen-lockfile install with workspace nodeLinker: hoisted.
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { cleanJsrTempDirs } from './clean-jsr-temp-dirs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

if (process.env.CI === 'true') {
  console.log('[dist-win-hoist] CI environment — skipping redundant hoisted install.');
  process.exit(0);
}

const maxAttempts = process.platform === 'win32' ? 3 : 1;
let lastStatus = 1;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  if (attempt > 1) {
    cleanJsrTempDirs(path.join(projectRoot, 'node_modules'));
  }

  const result = spawnSync('pnpm', ['install', '--config.node-linker=hoisted'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  lastStatus = result.status ?? 1;
  if (lastStatus === 0) {
    process.exit(0);
  }
  if (attempt < maxAttempts) {
    console.warn(
      `[dist-win-hoist] pnpm install failed (attempt ${attempt}/${maxAttempts}), retrying…`,
    );
  }
}

process.exit(lastStatus);
