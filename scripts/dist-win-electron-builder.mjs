#!/usr/bin/env node
/**
 * Run `electron-builder --win` with Azure Trusted Signing enabled iff signing
 * credentials are present.
 *
 * Steps:
 *   1. ci-write-win-azure-signing writes the overlay config only when creds exist.
 *   2. If the overlay exists, pass `--config electron-builder.win-signing.yml`
 *      (which `extends: ./electron-builder.yml` and adds win.azureSignOptions).
 *      Otherwise electron-builder uses the default (unsigned) electron-builder.yml.
 *
 * This keeps a single `dist:win` path: unsigned by default (fork PRs, local, and
 * dormant releases stay green), signed automatically once CI secrets are set.
 *
 * Extra CLI args are passed through, e.g. `--publish never`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { OVERLAY_FILENAME, writeWinAzureSigningConfig } from './ci-write-win-azure-signing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/**
 * Resolve the electron-builder args, injecting `--config <overlay>` when signing
 * is active. Pure for testability.
 * @param {string | null} overlayPath absolute path, or null when unsigned
 * @param {string[]} passthroughArgs
 * @returns {string[]}
 */
export function resolveElectronBuilderArgs(overlayPath, passthroughArgs) {
  const args = ['--win'];
  if (overlayPath) {
    args.push('--config', OVERLAY_FILENAME);
  }
  return [...args, ...passthroughArgs];
}

function main() {
  const passthrough = process.argv.slice(2);
  const overlayPath = writeWinAzureSigningConfig();
  const args = resolveElectronBuilderArgs(overlayPath, passthrough);

  console.debug(
    `[dist-win-electron-builder] electron-builder ${args.join(' ')} ` +
      `(${overlayPath ? 'SIGNED via Azure Trusted Signing' : 'unsigned'})`,
  );

  const result = spawnSync('electron-builder', args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(
      `[dist-win-electron-builder] failed to start electron-builder: ${result.error.message}`,
    );
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main();
}
