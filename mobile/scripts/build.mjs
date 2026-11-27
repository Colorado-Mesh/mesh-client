#!/usr/bin/env node
/**
 * Build the mobile app web bundle (`mobile/dist/`): renderer + preload via
 * `mobile/vite.config.mts`, then the host worker (`mobile/scripts/build-host.mjs`).
 * Usage: pnpm -C mobile run build [-- --minify]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMobileHost } from './build-host.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const minify = process.argv.includes('--minify');

const vite = spawnSync(
  process.execPath,
  [
    path.join(mobileRoot, '..', 'node_modules/vite/bin/vite.js'),
    'build',
    '--config',
    'vite.config.mts',
  ],
  { cwd: mobileRoot, stdio: 'inherit' },
);
if (vite.status !== 0) process.exit(vite.status ?? 1);
await buildMobileHost({ minify });
console.info('mobile web bundle ready in mobile/dist/');
