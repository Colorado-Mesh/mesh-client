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
 *   1. the process stays alive past a startup threshold (no crash exit), and
 *   2. `mesh-client.log` shows the renderer actually loaded — a `[Startup] renderer URL:`
 *      line or a `[renderer` source line — and does not contain renderer-gone,
 *      failed-load, or child-process-gone lines.
 *
 * Only the native-arch AppImage is launched: an arm64 runtime cannot execute on
 * an x64 runner (that image is still covered by the sidecar extraction smoke).
 *
 * Exits 0 on success. Failures throw so the extract and user-data dirs are removed
 * before the process exits 1.
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

export const LOG_FILENAME = 'mesh-client.log';
/** How long the process must stay alive to count as "booted" (ms). */
export const STARTUP_ALIVE_MS = 20_000;
/** How long to wait for the renderer-loaded log line to appear (ms). */
export const LOG_WAIT_MS = 25_000;
/** Poll interval while waiting for the log file (ms). */
const LOG_POLL_MS = 500;
/** Grace period for a clean kill before SIGKILL (ms). */
const KILL_GRACE_MS = 5_000;
/** `--appimage-extract` must finish within this or the smoke fails (ms). */
const EXTRACT_TIMEOUT_MS = 120_000;
/** Keep only the tail of a child's stdio so a noisy boot cannot grow without bound. */
const STDIO_TAIL_MAX = 64 * 1024;

/**
 * Thrown by {@link fail} so `main`'s `finally` still removes temp dirs.
 * `process.exit` would skip that cleanup.
 */
export class LaunchSmokeError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'LaunchSmokeError';
  }
}

/** @param {string} msg */
function fail(msg) {
  throw new LaunchSmokeError(msg);
}

/** @param {string} name */
function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/**
 * True when the log shows the renderer was loaded.
 *
 * `formatLine` in `src/main/log-service.ts` writes every main-process line as
 * `[level] [main] …`, so a bare `[main]` match is true for errors and for lines
 * written before any window exists. A real boot logs `[Startup] renderer URL:`
 * (console.debug, just before `loadURL`) and, once the page runs, renderer-source
 * lines (`[renderer]` / `[renderer:file:line]` via `forwardRendererConsoleMessage`).
 * @param {string} logText
 */
export function logShowsStartup(logText) {
  if (typeof logText !== 'string' || logText.length === 0) return false;
  return /\[Startup\] renderer URL:|\[renderer/.test(logText);
}

/**
 * True when the log or captured stdio shows the renderer/window failed.
 *
 * These paths (`render-process-gone`, `did-fail-load`, `child-process-gone`) log
 * and then call a blocking `dialog.showErrorBox`, so the process stays alive.
 * `console.error` echoes to stderr before that dialog; the async log append may
 * not flush while the dialog blocks, so callers must pass stderr as well as the file.
 * @param {string} text
 */
export function logShowsRendererFailure(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return /\[main\] Renderer process gone:|\[main\] Failed to load:|\[main\] Failed to load renderer:|\[main\] child-process-gone:/.test(
    text,
  );
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

/** @param {number} ms */
function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {string} buf
 * @param {string} chunk
 */
function appendCapped(buf, chunk) {
  const next = buf + chunk;
  return next.length <= STDIO_TAIL_MAX ? next : next.slice(-STDIO_TAIL_MAX);
}

/**
 * Terminate the child, marking teardown as intentional so its exit is not
 * treated as a crash. Pass the shared `state` used by launchAndAssert.
 * @param {import('child_process').ChildProcess} child
 * @param {{ teardownStarted: boolean }} state
 */
async function killChild(child, state) {
  state.teardownStarted = true;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // catch-no-log-ok process already exited
    return;
  }
  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleepMs(100);
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // catch-no-log-ok process already exited
  }
}

/**
 * @param {string} logPath
 * @param {string} previous
 */
function readLog(logPath, previous) {
  if (!existsSync(logPath)) return previous;
  try {
    return readFileSync(logPath, 'utf-8');
  } catch {
    // catch-no-log-ok transient read while the app is writing
    return previous;
  }
}

/**
 * Spawn a command and assert it boots: it must stay alive for `startupAliveMs`
 * and its user-data log must show a renderer-loaded signal with no renderer
 * failure lines. Production passes the extracted AppRun; tests pass `node -e`.
 *
 * @param {object} opts
 * @param {string} opts.command Executable to spawn (AppRun, or `process.execPath` in tests).
 * @param {string[]} [opts.args]
 * @param {string} [opts.cwd]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} opts.userDataDir
 * @param {number} [opts.startupAliveMs]
 * @param {number} [opts.logWaitMs]
 * @param {number} [opts.pollMs]
 */
export async function launchAndAssert({
  command,
  args = [],
  cwd,
  env = buildLaunchEnv(),
  userDataDir,
  startupAliveMs = STARTUP_ALIVE_MS,
  logWaitMs = LOG_WAIT_MS,
  pollMs = LOG_POLL_MS,
}) {
  const logPath = path.join(userDataDir, LOG_FILENAME);
  let stdioBuf = '';
  /** Shared teardown flag so our own SIGTERM/SIGKILL is not counted as a crash. */
  const state = { teardownStarted: false };
  /** @type {{ code: number | null, signal: NodeJS.Signals | null, error?: string } | null} */
  let crashExit = null;

  const spawnedAt = Date.now();
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onChunk = (d) => {
    stdioBuf = appendCapped(stdioBuf, String(d));
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);
  child.on('error', (err) => {
    if (!state.teardownStarted && !crashExit) {
      crashExit = { code: null, signal: null, error: err.message };
    }
  });
  child.on('exit', (code, signal) => {
    // Any exit before we start teardown is a crash — including signal exits
    // (OOM kill, external SIGTERM). Only exits after killChild() are expected.
    if (!state.teardownStarted && !crashExit) {
      crashExit = { code, signal };
    }
  });

  const observedText = (logText) => `${logText}\n${stdioBuf}`;

  try {
    let logText = '';
    let sawStartup = false;
    const logDeadline = spawnedAt + logWaitMs;

    // One wait: hold until startupAliveMs has elapsed since spawn (the renderer
    // marker can show up in well under a second) while a crash exit or a
    // renderer-failure line fails the run immediately.
    while (!sawStartup || Date.now() - spawnedAt < startupAliveMs) {
      if (crashExit) {
        const extra = crashExit.error ? ` error=${crashExit.error}` : '';
        fail(
          `App exited ${sawStartup ? 'shortly after startup' : 'during startup'} ` +
            `(code=${crashExit.code}, signal=${crashExit.signal}${extra}).\n` +
            `--- stderr/stdout (last 2KB) ---\n${tailText(stdioBuf, 2048)}`,
        );
      }

      logText = readLog(logPath, logText);
      if (logShowsRendererFailure(observedText(logText))) {
        fail(
          'Renderer failed to stay up (renderer-gone, failed-load, or child-process-gone).\n' +
            `--- log (last 2KB) ---\n${tailText(logText, 2048)}\n` +
            `--- stderr/stdout (last 2KB) ---\n${tailText(stdioBuf, 2048)}`,
        );
      }

      if (!sawStartup && logShowsStartup(logText)) {
        sawStartup = true;
      }

      if (sawStartup && Date.now() - spawnedAt >= startupAliveMs) break;

      if (!sawStartup && Date.now() >= logDeadline) {
        fail(
          `No renderer-loaded signal in ${LOG_FILENAME} within ${logWaitMs}ms ` +
            '(expected "[Startup] renderer URL:" or a "[renderer" line).\n' +
            `--- log (last 2KB) ---\n${tailText(logText, 2048)}\n` +
            `--- stderr/stdout (last 2KB) ---\n${tailText(stdioBuf, 2048)}`,
        );
      }

      await sleepMs(pollMs);
    }

    logText = readLog(logPath, logText);
    if (crashExit) {
      const extra = crashExit.error ? ` error=${crashExit.error}` : '';
      fail(
        `App exited shortly after startup (code=${crashExit.code}, signal=${crashExit.signal}${extra}).\n` +
          `--- stderr/stdout (last 2KB) ---\n${tailText(stdioBuf, 2048)}`,
      );
    }
    if (logShowsRendererFailure(observedText(logText))) {
      fail(
        'Renderer failed to stay up (renderer-gone, failed-load, or child-process-gone).\n' +
          `--- log (last 2KB) ---\n${tailText(logText, 2048)}\n` +
          `--- stderr/stdout (last 2KB) ---\n${tailText(stdioBuf, 2048)}`,
      );
    }
  } finally {
    await killChild(child, state);
  }

  console.debug('[test-linux-appimage-launch] OK — app booted and the renderer loaded');
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
        command: appRun,
        args: buildLaunchArgs(userDataDir),
        cwd: payloadRoot,
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
