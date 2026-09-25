#!/usr/bin/env node
/**
 * CI smoke: launch the packaged Linux AppImage headlessly and prove it boots.
 *
 * The existing Linux packaging smoke (verify-linux-packaging.mjs,
 * test-linux-appimage-reticulum-sidecar.mjs) checks file structure, ELF headers,
 * and sidecar staging but never *runs* the app. The Playwright E2E suite launches
 * the unpackaged dev build, not the shipped AppImage. This closes that gap: it
 * extracts the AppImage and launches its `AppRun` under Xvfb with a throwaway
 * user-data dir, then asserts:
 *   1. the process stays alive past a startup threshold (no immediate crash), and
 *   2. `mesh-client.log` in the user-data dir shows main-process startup lines.
 *
 * Only the native-arch AppImage is launched: an arm64 runtime cannot execute on
 * an x64 runner (that image is still covered by the sidecar extraction smoke).
 *
 * Exits 0 on success, 1 on failure with diagnostics.
 */
import { spawn, spawnSync } from 'child_process';
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

import {
  appImageNeedsUnsquashfsExtract,
  prepareAppImageExtractDir,
} from './test-linux-appimage-reticulum-sidecar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const LOG_FILENAME = 'mesh-client.log';
/** How long the process must stay alive to count as "booted" (ms). */
export const STARTUP_ALIVE_MS = 20_000;
/** How long to wait for the startup log lines to appear (ms). */
export const LOG_WAIT_MS = 25_000;
/** Poll interval while waiting for the log file (ms). */
const LOG_POLL_MS = 500;
/** Grace period for a clean kill before SIGKILL (ms). */
const KILL_GRACE_MS = 5_000;

/** @param {string} msg */
function fail(msg) {
  console.error(`[test-linux-appimage-launch] ${msg}`);
  process.exit(1);
}

/** @param {string} name */
function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/**
 * A crash-free boot is proven by these main-process startup markers appearing in
 * mesh-client.log. `[main]` is the tag every early main-process log line uses.
 * @param {string} logText
 */
export function logShowsStartup(logText) {
  if (typeof logText !== 'string' || logText.length === 0) return false;
  return /\[main\]/.test(logText);
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

/**
 * Extract an AppImage to a fresh dir and return the squashfs-root path.
 * Uses the native `--appimage-extract` (same-arch); callers gate on
 * {@link shouldLaunchOnHost} so cross-arch extraction is never needed here.
 * @param {string} appImagePath
 * @param {string} extractDir
 */
function extractAppImage(appImagePath, extractDir) {
  prepareAppImageExtractDir(extractDir);
  // Artifact downloads may drop +x on AppImages.
  chmodSync(appImagePath, 0o755);
  const result = spawnSync(appImagePath, ['--appimage-extract'], {
    cwd: extractDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    fail(`Failed to run AppImage extract: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(`AppImage extract exited ${result.status ?? 'null'} for ${appImagePath}`);
  }
  const payloadRoot = path.join(extractDir, 'squashfs-root');
  if (!existsSync(payloadRoot)) {
    fail(`AppImage extract did not create squashfs-root under ${extractDir}`);
  }
  return payloadRoot;
}

/** @param {number} ms */
function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll for the log file to appear and contain startup markers, up to LOG_WAIT_MS.
 * @param {string} logPath
 */
async function waitForStartupLog(logPath) {
  const deadline = Date.now() + LOG_WAIT_MS;
  let lastText = '';
  while (Date.now() < deadline) {
    if (existsSync(logPath)) {
      try {
        lastText = readFileSync(logPath, 'utf-8');
      } catch {
        // catch-no-log-ok transient read while the app is writing
      }
      if (logShowsStartup(lastText)) return { ok: true, text: lastText };
    }
    await sleepMs(LOG_POLL_MS);
  }
  return { ok: false, text: lastText };
}

/** @param {import('child_process').ChildProcess} child */
async function killChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleepMs(100);
  }
  child.kill('SIGKILL');
}

/**
 * Launch AppRun from an extracted AppImage and assert it boots.
 * @param {string} payloadRoot
 * @param {string} userDataDir
 */
async function launchAndAssert(payloadRoot, userDataDir) {
  const appRun = path.join(payloadRoot, 'AppRun');
  if (!existsSync(appRun)) {
    fail(`AppRun not found in extracted AppImage: ${appRun}`);
  }
  chmodSync(appRun, 0o755);

  const logPath = path.join(userDataDir, LOG_FILENAME);
  /** @type {string} */
  let stderrBuf = '';
  /** @type {{ code: number | null, signal: NodeJS.Signals | null } | null} */
  let earlyExit = null;

  const child = spawn(appRun, buildLaunchArgs(userDataDir), {
    cwd: payloadRoot,
    env: buildLaunchEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => {
    stderrBuf += String(d);
  });
  child.on('exit', (code, signal) => {
    // Record only an *early* exit; a SIGTERM/SIGKILL from our own teardown is expected.
    if (signal !== 'SIGTERM' && signal !== 'SIGKILL') {
      earlyExit = { code, signal };
    }
  });

  // Wait for the startup log while also watching for an early crash exit.
  const logResult = await waitForStartupLog(logPath);

  if (earlyExit) {
    await killChild(child);
    fail(
      `App exited during startup (code=${earlyExit.code}, signal=${earlyExit.signal}).\n` +
        `--- stderr (last 2KB) ---\n${stderrBuf.slice(-2048)}`,
    );
  }

  if (!logResult.ok) {
    await killChild(child);
    fail(
      `No main-process startup lines in ${LOG_FILENAME} within ${LOG_WAIT_MS}ms.\n` +
        `--- log (last 2KB) ---\n${logResult.text.slice(-2048)}\n` +
        `--- stderr (last 2KB) ---\n${stderrBuf.slice(-2048)}`,
    );
  }

  // Ensure it is still alive after the startup threshold (catches delayed crashes).
  const remaining = STARTUP_ALIVE_MS - LOG_WAIT_MS;
  if (remaining > 0) await sleepMs(remaining);
  if (earlyExit) {
    await killChild(child);
    fail(
      `App crashed shortly after startup (code=${earlyExit.code}, signal=${earlyExit.signal}).\n` +
        `--- stderr (last 2KB) ---\n${stderrBuf.slice(-2048)}`,
    );
  }

  await killChild(child);
  console.debug(`[test-linux-appimage-launch] OK — app booted and logged startup lines`);
}

async function main() {
  if (process.platform !== 'linux') {
    console.debug('[test-linux-appimage-launch] Skipping on non-Linux host');
    return;
  }
  if (!existsSync(releaseDir)) {
    fail(`Missing release directory: ${releaseDir}`);
  }

  const appImages = readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.AppImage'))
    .map((e) => e.name);

  if (appImages.length === 0) {
    fail('No AppImage found in release/');
  }

  // Launch only the native-arch AppImage; cross-arch cannot execute here.
  const launchable = appImages.filter((name) => shouldLaunchOnHost(path.join(releaseDir, name)));
  if (launchable.length === 0) {
    console.debug(
      `[test-linux-appimage-launch] No native-arch AppImage to launch on ${process.arch}; skipping ` +
        `(cross-arch images are covered by test-linux-appimage-reticulum-sidecar.mjs)`,
    );
    return;
  }

  for (const name of launchable) {
    const appImagePath = path.join(releaseDir, name);
    if (statSync(appImagePath).size < 50 * 1024 * 1024) {
      fail(`AppImage too small (${statSync(appImagePath).size} bytes): ${appImagePath}`);
    }
    const label = isArm64Name(name) ? 'arm64' : 'x64';
    const extractDir = mkdtempSync(path.join(tmpdir(), `mesh-client-launch-${label}-`));
    const userDataDir = mkdtempSync(path.join(tmpdir(), `mesh-client-userdata-${label}-`));
    try {
      const payloadRoot = extractAppImage(appImagePath, extractDir);
      await launchAndAssert(payloadRoot, userDataDir);
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
  main().catch((e) => {
    console.error('[test-linux-appimage-launch] Unexpected error:', e);
    process.exit(1);
  });
}
