#!/usr/bin/env node
/**
 * Dev orchestrator: runs main/preload esbuild watch, Vite, and Electron via concurrently.
 * Uses direct esbuild/vite binaries (not nested `pnpm run`) so signal shutdown does not
 * produce pnpm ELIFECYCLE noise when Electron exits or the terminal sends SIGINT.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** @param {number | null} code @param {NodeJS.Signals | null} signal */
export function resolveDevExitCode(code, signal) {
  if (signal === 'SIGINT' || signal === 'SIGTERM') return 0;
  if (code === 0 || code === null) return 0;
  return code;
}

export function buildDevConcurrentlyArgs() {
  const mainBuild =
    'esbuild src/main/index.ts --bundle --platform=node --outfile=dist-electron/main/index.js --external:electron --external:electron-updater --external:systeminformation --external:@stoprocent/noble --external:node-forge --external:jszip --external:mqtt --external:@bufbuild/protobuf --external:@meshtastic/protobufs --format=cjs --watch';
  const preloadBuild =
    'esbuild src/preload/index.ts --bundle --platform=node --outfile=dist-electron/preload/index.js --external:electron --format=cjs --watch';
  const electronLaunch =
    'node scripts/wait-for-dev.mjs && VITE_DEV_SERVER_URL=http://localhost:5173 ELECTRON_ENABLE_SECURITY_WARNINGS=1 electron .';

  return [
    '-k',
    '-s',
    'command-electron',
    '--names',
    'main,preload,vite,electron',
    mainBuild,
    preloadBuild,
    'vite',
    electronLaunch,
  ];
}

export function runDev(argv = process.argv.slice(2)) {
  if (argv.length > 0) {
    console.error('[run-dev] Unexpected arguments:', argv.join(' '));
    process.exit(1);
  }

  const concurrentlyBin = path.join(projectRoot, 'node_modules', '.bin', 'concurrently');
  const child = spawn(concurrentlyBin, buildDevConcurrentlyArgs(), {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (err) => {
    console.error('[run-dev] Failed to start concurrently:', err);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    process.exit(resolveDevExitCode(code, signal));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDev();
}
