#!/usr/bin/env node
/**
 * Offline pnpm install for Flatpak builds with retry on @jsr temp-dir races.
 *
 * Failure point: pnpm install races renaming @jsr/_tmp_* during hoisted offline
 * install inside flatpak-builder sandbox. Fallback: clean stale temps and retry.
 *
 * Failure point: host/CI runs without the Flatpak-vendored store at STORE_DIR.
 * pnpm 11+ may report "Already up to date" from an existing node_modules even when
 * --store-dir is missing; refuse to proceed so Flatpak always uses the offline store.
 *
 * Failure point: pnpm 11 re-verifies minimumReleaseAge / trustPolicy against the
 * registry for every lockfile entry ("Verifying lockfile against supply-chain
 * policies"). Flatpak build has no usable DNS, so those GETs hang on EAI_AGAIN.
 * Fallback: --config.trust-lockfile=true (CI already resolved the lockfile online).
 */
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { cleanJsrTempDirs } from './clean-jsr-temp-dirs.mjs';
import {
  stripNpmrcStoreDirLines,
  stripPnpmWorkspaceStoreDirLines,
} from './flatpakPnpmStoreVersion.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
export const STORE_DIR = '/run/build/mesh-client/flatpak-node/pnpm-store';
const maxAttempts = 3;

/** Args passed to `pnpm` for Flatpak offline install (exported for contract tests). */
export const FLATPAK_PNPM_INSTALL_ARGS = [
  'install',
  '--frozen-lockfile',
  '--offline',
  '--ignore-scripts',
  '--config.trust-lockfile=true',
  '--store-dir',
  STORE_DIR,
];

/**
 * Remove generator-appended storeDir / store-dir lines so pnpm can parse the
 * workspace and `--store-dir` (sandbox path) wins over a host-cache path.
 *
 * @param {string} [root]
 * @returns {{ workspaceRemoved: number, npmrcRemoved: number }}
 */
export function sanitizeFlatpakPnpmStoreDirConfig(root = projectRoot) {
  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  const npmrcPath = path.join(root, '.npmrc');
  let workspaceRemoved = 0;
  let npmrcRemoved = 0;

  if (fs.existsSync(workspacePath)) {
    const before = fs.readFileSync(workspacePath, 'utf8');
    const { yaml, removed } = stripPnpmWorkspaceStoreDirLines(before);
    workspaceRemoved = removed;
    if (removed > 0) {
      fs.writeFileSync(workspacePath, yaml, 'utf8');
      console.warn(
        `[flatpak-pnpm] stripped ${removed} storeDir line(s) from pnpm-workspace.yaml (using --store-dir ${STORE_DIR})`,
      );
    }
  }

  if (fs.existsSync(npmrcPath)) {
    const before = fs.readFileSync(npmrcPath, 'utf8');
    const { text, removed } = stripNpmrcStoreDirLines(before);
    npmrcRemoved = removed;
    if (removed > 0) {
      fs.writeFileSync(npmrcPath, text, 'utf8');
      console.warn(
        `[flatpak-pnpm] stripped ${removed} store-dir line(s) from .npmrc (using --store-dir ${STORE_DIR})`,
      );
    }
  }

  return { workspaceRemoved, npmrcRemoved };
}

export function runFlatpakPnpmInstall() {
  if (!fs.existsSync(STORE_DIR)) {
    console.error(
      `[flatpak-pnpm] offline store missing: ${STORE_DIR} (Flatpak sandbox path required)`,
    );
    process.exit(1);
  }

  sanitizeFlatpakPnpmStoreDirConfig(projectRoot);

  let lastStatus = 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      cleanJsrTempDirs(path.join(projectRoot, 'node_modules'));
    }

    const result = spawnSync('pnpm', FLATPAK_PNPM_INSTALL_ARGS, {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    lastStatus = result.status ?? 1;
    if (lastStatus === 0) {
      process.exit(0);
    }
    if (attempt < maxAttempts) {
      console.warn(
        `[flatpak-pnpm] pnpm install failed (attempt ${attempt}/${maxAttempts}), retrying…`,
      );
    }
  }

  process.exit(lastStatus);
}

const isDirectRun =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runFlatpakPnpmInstall();
}
