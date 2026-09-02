#!/usr/bin/env node
/**
 * Stage Flatpak-vendored Electron into node_modules/electron/dist before rebuild.
 *
 * Failure point: pnpm --ignore-scripts skips electron postinstall, and the
 * flatpak-builder sandbox has no network for electron/install.js. The vendored
 * electron-prebuilt archive must be copied into dist/ so rebuild-native can
 * probe the binary and run install-app-deps offline.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isElectronBinaryInstalled } from './electron-binary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');
export const FLATPAK_ELECTRON_PREBUILT = path.join(projectRoot, 'electron-prebuilt');

/**
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {string} [opts.prebuiltDir]
 */
export function stageFlatpakElectron({
  root = projectRoot,
  prebuiltDir = FLATPAK_ELECTRON_PREBUILT,
} = {}) {
  if (!existsSync(prebuiltDir)) {
    console.error(`[flatpak-electron] vendored prebuilt missing: ${prebuiltDir}`);
    process.exit(1);
  }

  const distDir = path.join(root, 'node_modules', 'electron', 'dist');
  mkdirSync(path.dirname(distDir), { recursive: true });
  rmSync(distDir, { recursive: true, force: true });
  cpSync(prebuiltDir, distDir, { recursive: true });

  if (!isElectronBinaryInstalled(root, 'linux', existsSync)) {
    console.error(`[flatpak-electron] staged binary missing under ${distDir}`);
    process.exit(1);
  }

  console.log(`[flatpak-electron] staged ${prebuiltDir} -> ${distDir}`);
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  stageFlatpakElectron();
}
