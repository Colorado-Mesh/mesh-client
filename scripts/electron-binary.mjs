#!/usr/bin/env node
/**
 * Electron 42+ lazy-download helpers: ensure node_modules/electron/dist exists
 * before rebuild-native or start-electron spawn the binary directly.
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');

/** @param {string} platform @param {(p: string) => boolean} fileExists @param {string} [root] */
export function resolveLocalElectronBin(
  platform = process.platform,
  fileExists = existsSync,
  root = projectRoot,
) {
  const distDir = path.join(root, 'node_modules', 'electron', 'dist');
  const platformCandidates =
    platform === 'darwin'
      ? [path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron')]
      : platform === 'win32'
        ? [path.join(distDir, 'electron.exe')]
        : [path.join(distDir, 'electron')];
  const fallbackCandidates = [
    path.join(distDir, 'electron'),
    path.join(distDir, 'electron.exe'),
    path.join(distDir, 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  ];
  const candidates = [...platformCandidates, ...fallbackCandidates];
  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return platformCandidates[0];
}

/** @param {string} [root] @param {string} [platform] @param {(p: string) => boolean} [fileExists] */
export function isElectronBinaryInstalled(
  root = projectRoot,
  platform = process.platform,
  fileExists = existsSync,
) {
  const candidate = resolveLocalElectronBin(platform, fileExists, root);
  return fileExists(candidate);
}

/**
 * Run electron/install.js when the prebuilt binary is missing (Electron 42+ lazy download).
 *
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @param {(p: string) => boolean} [opts.fileExists]
 */
export function ensureElectronBinaryInstalled({
  root = projectRoot,
  spawnSyncFn = spawnSync,
  fileExists = existsSync,
} = {}) {
  if (isElectronBinaryInstalled(root, process.platform, fileExists)) {
    return { installed: true, skipped: true };
  }

  const installJs = path.join(root, 'node_modules', 'electron', 'install.js');
  if (!fileExists(installJs)) {
    throw new Error(
      'Electron binary is missing and node_modules/electron/install.js was not found. Run pnpm install first.',
    );
  }

  console.log('Electron binary not found — downloading via electron/install.js…');
  const result = spawnSyncFn(process.execPath, [installJs], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`electron/install.js exited with status ${result.status ?? 'unknown'}`);
  }

  if (!isElectronBinaryInstalled(root, process.platform, fileExists)) {
    throw new Error('Electron install.js completed but the binary is still missing.');
  }

  return { installed: true, skipped: false };
}
