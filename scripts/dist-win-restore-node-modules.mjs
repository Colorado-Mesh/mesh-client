#!/usr/bin/env node
/**
 * After dist:win hoisted packaging, restore default pnpm node_modules layout
 * for local development.
 *
 * Failure point: pnpm install races on Windows after electron-builder (ENOTEMPTY
 * on @jsr temp dirs). Fallback: skip restore in CI — packaging is already done.
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

if (process.env.CI === 'true') {
  console.log('[dist-win-restore] CI environment — skipping node_modules restore.');
  process.exit(0);
}

const maxAttempts = process.platform === 'win32' ? 3 : 1;
let lastStatus = 1;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const result = spawnSync('pnpm', ['install'], {
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
      `[dist-win-restore] pnpm install failed (attempt ${attempt}/${maxAttempts}), retrying…`,
    );
  }
}

process.exit(lastStatus);
