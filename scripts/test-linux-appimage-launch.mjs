#!/usr/bin/env node
/**
 * CI smoke: launch the packaged Linux AppImage headlessly and prove it boots.
 *
 * The existing Linux packaging smoke (verify-linux-packaging.mjs,
 * test-linux-appimage-reticulum-sidecar.mjs) checks file structure, ELF headers,
 * and sidecar staging but never *runs* the app. The Playwright E2E suite launches
 * the unpackaged dev build, not the shipped AppImage. This closes that gap: it
 * extracts the AppImage and launches its `AppRun` under Xvfb with a throwaway
 * user-data dir, then asserts via the shared packaged-launch-smoke engine:
 *   1. the process stays alive past a startup threshold (no crash exit), and
 *   2. `mesh-client.log` shows the renderer actually loaded — a `[Startup] renderer loaded:`
 *      line after the final `loadURL` resolves — and does not contain renderer-gone,
 *      failed-load, or child-process-gone lines.
 *
 * Only the native-arch AppImage is launched: an arm64 runtime cannot execute on
 * an x64 runner (that image is still covered by the sidecar extraction smoke).
 * If no AppImage matches the host architecture, the smoke fails instead of exiting 0.
 *
 * Exits 0 on success. Failures throw so the extract and user-data dirs are removed
 * before the process exits 1.
 */
import { spawnSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';

import { LaunchSmokeError, launchAndAssert } from './packaged-launch-smoke.mjs';
import {
  appImageNeedsUnsquashfsExtract,
  prepareAppImageExtractDir,
} from './test-linux-appimage-reticulum-sidecar.mjs';

export {
  launchAndAssert,
  LaunchSmokeError,
  LOG_FILENAME,
  LOG_WAIT_MS,
  logShowsRendererFailure,
  logShowsStartup,
  STARTUP_ALIVE_MS,
} from './packaged-launch-smoke.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

/** `--appimage-extract` must finish within this or the smoke fails (ms). */
const EXTRACT_TIMEOUT_MS = 120_000;

/** @param {string} msg */
function fail(msg) {
  throw new LaunchSmokeError(msg);
}

/** @param {string} name */
function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/**
 * Whether the given AppImage should be launched on this host. Only the AppImage
 * whose runtime matches the host arch can execute; a cross-arch image is skipped.
 * @param {string} appImagePath
 * @param {string} [hostArch=process.arch]
 */
export function shouldLaunchOnHost(appImagePath, hostArch = process.arch) {
  return !appImageNeedsUnsquashfsExtract(appImagePath, hostArch);
}

/**
 * AppImage names in `dir` whose runtime matches `hostArch`.
 * A missing native-arch artifact fails the smoke so it cannot pass silently.
 * @param {string} dir
 * @param {string} [hostArch=process.arch]
 * @returns {string[]}
 */
export function listLaunchableAppImages(dir, hostArch = process.arch) {
  if (!existsSync(dir)) {
    fail(`Missing release directory: ${dir}`);
  }

  const appImages = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.AppImage'))
    .map((e) => e.name);

  if (appImages.length === 0) {
    fail('No AppImage found in release/');
  }

  const launchable = appImages.filter((name) => shouldLaunchOnHost(path.join(dir, name), hostArch));
  if (launchable.length === 0) {
    fail(`No native-arch AppImage to launch on ${hostArch} (found: ${appImages.join(', ')})`);
  }
  return launchable;
}

/**
 * Build the launch argv for AppRun. Sandbox is disabled because Chromium's
 * setuid sandbox is unreliable under headless/CI Linux (matches electronApp.ts
 * and start-electron.mjs), and user data is redirected to a throwaway dir.
 * @param {string} userDataDir
 */
export function buildLaunchArgs(userDataDir) {
  return [`--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-setuid-sandbox'];
}

/**
 * Environment for a headless launch: disable GPU/HW acceleration (honored by the
 * main process on Linux) so it runs cleanly under Xvfb.
 * @param {NodeJS.ProcessEnv} [baseEnv=process.env]
 */
export function buildLaunchEnv(baseEnv = process.env) {
  return { ...baseEnv, MESH_CLIENT_DISABLE_GPU: '1' };
}

/** @param {string} text @param {number} [max] */
function tailText(text, max = 8192) {
  if (text.length <= max) return text;
  return text.slice(-max);
}

/**
 * @param {string} message
 * @param {import('child_process').SpawnSyncReturns<string>} result
 */
function failExtract(message, result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const output = tailText(`${stdout}\n${stderr}`.trim());
  fail(output ? `${message}\n--- extract output (tail) ---\n${output}` : message);
}

/**
 * Extract an AppImage to a fresh dir and return the squashfs-root path.
 * Uses the native `--appimage-extract` (same-arch); callers gate on
 * {@link shouldLaunchOnHost} so cross-arch extraction is never needed here.
 * File listing stays out of the CI log unless extraction fails.
 * @param {string} appImagePath
 * @param {string} extractDir
 */
function extractAppImage(appImagePath, extractDir) {
  prepareAppImageExtractDir(extractDir);
  // Artifact downloads may drop +x on AppImages.
  chmodSync(appImagePath, 0o755);
  const result = spawnSync(appImagePath, ['--appimage-extract'], {
    cwd: extractDir,
    env: process.env,
    encoding: 'utf8',
    timeout: EXTRACT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    failExtract(
      timedOut
        ? `AppImage extract timed out after ${EXTRACT_TIMEOUT_MS}ms for ${appImagePath}`
        : `Failed to run AppImage extract: ${result.error.message}`,
      result,
    );
  }
  if ((result.status ?? 1) !== 0) {
    failExtract(`AppImage extract exited ${result.status ?? 'null'} for ${appImagePath}`, result);
  }
  const payloadRoot = path.join(extractDir, 'squashfs-root');
  if (!existsSync(payloadRoot)) {
    failExtract(`AppImage extract did not create squashfs-root under ${extractDir}`, result);
  }
  return payloadRoot;
}

async function main() {
  if (process.platform !== 'linux') {
    console.debug('[test-linux-appimage-launch] Skipping on non-Linux host');
    return;
  }
  // Launch only the native-arch AppImage; cross-arch cannot execute here.
  // No match is a failure: a missing artifact must not exit 0.
  const launchable = listLaunchableAppImages(releaseDir);

  for (const name of launchable) {
    const appImagePath = path.join(releaseDir, name);
    const size = statSync(appImagePath).size;
    if (size < 50 * 1024 * 1024) {
      fail(`AppImage too small (${size} bytes): ${appImagePath}`);
    }
    const label = isArm64Name(name) ? 'arm64' : 'x64';
    const extractDir = mkdtempSync(path.join(tmpdir(), `mesh-client-launch-${label}-`));
    const userDataDir = mkdtempSync(path.join(tmpdir(), `mesh-client-userdata-${label}-`));
    try {
      const payloadRoot = extractAppImage(appImagePath, extractDir);
      const appRun = path.join(payloadRoot, 'AppRun');
      if (!existsSync(appRun)) {
        fail(`AppRun not found in extracted AppImage: ${appRun}`);
      }
      chmodSync(appRun, 0o755);
      await launchAndAssert({
        label: 'test-linux-appimage-launch',
        command: appRun,
        args: buildLaunchArgs(userDataDir),
        cwd: payloadRoot,
        env: buildLaunchEnv(),
        userDataDir,
      });
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }

  const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
  console.debug(`[test-linux-appimage-launch] OK — native AppImage boots headlessly (v${version})`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    if (err instanceof LaunchSmokeError) {
      console.error(`[test-linux-appimage-launch] ${err.message}`);
    } else {
      console.error('[test-linux-appimage-launch] Unexpected error:', err);
    }
    process.exit(1);
  });
}
