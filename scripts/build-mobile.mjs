#!/usr/bin/env node
/**
 * Build the mobile app web bundle (`dist-mobile/`): renderer + preload via
 * `vite.mobile.config.mts`, then the host worker (`scripts/build-mobile-host.mjs`).
 * Usage: node scripts/build-mobile.mjs [--minify]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMobileHost } from './build-mobile-host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const minify = process.argv.includes('--minify');

const vite = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.mobile.config.mts'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
if (vite.status !== 0) process.exit(vite.status ?? 1);
await buildMobileHost({ minify });
console.info('mobile web bundle ready in dist-mobile/');
