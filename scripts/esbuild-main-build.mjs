#!/usr/bin/env node
/**
 * Build the Electron main process with shared external package list.
 * Usage: node scripts/esbuild-main-build.mjs [--minify] [--metafile=path]
 *
 * When MESH_CLIENT_BUILD_INFO is set (CI packaging), embeds it via esbuild define
 * as __MESH_CLIENT_BUILD_INFO__ for src/shared/buildInfo.ts.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mainEsbuildExternalArgs } from './esbuild-main-externals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const esbuildBin = require.resolve('esbuild/bin/esbuild');

const extraArgs = process.argv.slice(2);
const buildInfoRaw = process.env.MESH_CLIENT_BUILD_INFO ?? '';
const defineArg = `--define:__MESH_CLIENT_BUILD_INFO__=${JSON.stringify(buildInfoRaw)}`;

const args = [
  'src/main/index.ts',
  '--bundle',
  '--platform=node',
  '--outfile=dist-electron/main/index.js',
  ...mainEsbuildExternalArgs(),
  '--format=cjs',
  defineArg,
  ...extraArgs,
];

// shell:false so JSON quotes in --define survive on Windows runners
const result = spawnSync(esbuildBin, args, {
  cwd: projectRoot,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
