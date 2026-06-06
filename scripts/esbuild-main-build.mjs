#!/usr/bin/env node
/**
 * Build the Electron main process with shared external package list.
 * Usage: node scripts/esbuild-main-build.mjs [--minify] [--metafile=path]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mainEsbuildExternalArgs } from './esbuild-main-externals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const extraArgs = process.argv.slice(2);
const args = [
  'src/main/index.ts',
  '--bundle',
  '--platform=node',
  '--outfile=dist-electron/main/index.js',
  ...mainEsbuildExternalArgs(),
  '--format=cjs',
  ...extraArgs,
];

const result = spawnSync('esbuild', args, { cwd: projectRoot, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
