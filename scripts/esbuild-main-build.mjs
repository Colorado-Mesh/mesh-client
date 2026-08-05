#!/usr/bin/env node
/**
 * Build the Electron main process with shared external package list.
 * Usage: node scripts/esbuild-main-build.mjs [--minify] [--metafile=path]
 *
 * When MESH_CLIENT_BUILD_INFO is set (CI packaging), embeds it via esbuild define
 * as __MESH_CLIENT_BUILD_INFO__ for src/shared/buildInfo.ts.
 *
 * Uses the esbuild JS API (not a direct spawn of bin/esbuild). On Windows, postinstall leaves
 * bin/esbuild as a Node shim — execFile of that path fails with no stdout (EINVAL).
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAIN_ESBUILD_EXTERNALS } from './esbuild-main-externals.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * @param {string[]} argv
 * @returns {{ minify: boolean, metafilePath: string | null }}
 */
export function parseEsbuildMainBuildArgs(argv) {
  let minify = false;
  /** @type {string | null} */
  let metafilePath = null;
  for (const arg of argv) {
    if (arg === '--minify') {
      minify = true;
      continue;
    }
    if (arg.startsWith('--metafile=')) {
      metafilePath = arg.slice('--metafile='.length);
      continue;
    }
    throw new Error(`Unknown esbuild-main-build argument: ${arg}`);
  }
  return { minify, metafilePath };
}

/**
 * @param {{
 *   minify?: boolean
 *   metafilePath?: string | null
 *   buildInfoRaw?: string
 *   absWorkingDir?: string
 * }} [opts]
 */
export async function buildMainProcess(opts = {}) {
  const minify = opts.minify === true;
  const metafilePath = opts.metafilePath ?? null;
  const buildInfoRaw = opts.buildInfoRaw ?? process.env.MESH_CLIENT_BUILD_INFO ?? '';
  const absWorkingDir = opts.absWorkingDir ?? projectRoot;

  const result = await esbuild.build({
    absWorkingDir,
    entryPoints: ['src/main/index.ts'],
    bundle: true,
    platform: 'node',
    outfile: 'dist-electron/main/index.js',
    external: [...MAIN_ESBUILD_EXTERNALS],
    format: 'cjs',
    define: {
      __MESH_CLIENT_BUILD_INFO__: JSON.stringify(buildInfoRaw),
    },
    minify,
    metafile: Boolean(metafilePath),
    logLevel: 'info',
  });

  if (metafilePath && result.metafile) {
    const outPath = path.resolve(absWorkingDir, metafilePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result.metafile));
  }

  return result;
}

async function main() {
  const { minify, metafilePath } = parseEsbuildMainBuildArgs(process.argv.slice(2));
  await buildMainProcess({ minify, metafilePath });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
