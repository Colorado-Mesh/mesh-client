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

/** Default attempts for transient GitHub/CDN fetch failures during electron/install.js. */
export const ELECTRON_INSTALL_MAX_ATTEMPTS = 3;
/** Base backoff between install retries (ms); doubles each attempt. */
export const ELECTRON_INSTALL_RETRY_BASE_MS = 1500;

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
 * Sync sleep without busy-waiting (callers use spawnSync / postinstall).
 * @param {number} ms
 * @param {(ms: number) => void} [sleepFn]
 */
function sleepMs(ms, sleepFn) {
  if (sleepFn) {
    sleepFn(ms);
    return;
  }
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

/**
 * @param {number} maxAttempts
 * @param {number} retryBaseMs
 * @returns {{ attempts: number; retryBaseMs: number }}
 */
function validateRetryOptions(maxAttempts, retryBaseMs) {
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new Error(`maxAttempts must be a finite number >= 1, got ${String(maxAttempts)}`);
  }
  if (!Number.isFinite(retryBaseMs) || retryBaseMs < 0) {
    throw new Error(`retryBaseMs must be a finite non-negative number, got ${String(retryBaseMs)}`);
  }
  return { attempts: Math.floor(maxAttempts), retryBaseMs };
}

/**
 * Run electron/install.js when the prebuilt binary is missing (Electron 42+ lazy download).
 * Retries on transient CDN/network failures (common in CI: `TypeError: fetch failed`).
 *
 * @param {object} [opts]
 * @param {string} [opts.root]
 * @param {typeof spawnSync} [opts.spawnSyncFn]
 * @param {(p: string) => boolean} [opts.fileExists]
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.retryBaseMs]
 * @param {(ms: number) => void} [opts.sleepFn] - injectable sleep for tests
 * @param {(msg: string) => void} [opts.warn]
 */
export function ensureElectronBinaryInstalled({
  root = projectRoot,
  spawnSyncFn = spawnSync,
  fileExists = existsSync,
  maxAttempts = ELECTRON_INSTALL_MAX_ATTEMPTS,
  retryBaseMs = ELECTRON_INSTALL_RETRY_BASE_MS,
  sleepFn,
  warn = (msg) => process.stderr.write(`${msg}\n`),
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

  const { attempts, retryBaseMs: validatedRetryBaseMs } = validateRetryOptions(
    maxAttempts,
    retryBaseMs,
  );
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt === 1) {
      process.stdout.write('Electron binary not found — downloading via electron/install.js…\n');
    } else {
      const delayMs = validatedRetryBaseMs * 2 ** (attempt - 2);
      warn(
        `Electron download failed (attempt ${attempt - 1}/${attempts}); retrying in ${delayMs}ms…`,
      );
      sleepMs(delayMs, sleepFn);
    }

    const result = spawnSyncFn(process.execPath, [installJs], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env },
    });

    if (result.error) {
      lastError = result.error;
    } else if (result.status !== 0) {
      lastError = new Error(`electron/install.js exited with status ${result.status ?? 'unknown'}`);
    } else if (!isElectronBinaryInstalled(root, process.platform, fileExists)) {
      lastError = new Error('Electron install.js completed but the binary is still missing.');
    } else {
      return { installed: true, skipped: false, attempts: attempt };
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'Electron install failed'));
}
