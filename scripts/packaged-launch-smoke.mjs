/**
 * Shared packaged-app launch/assert engine for CI smoke tests.
 *
 * Platform wrappers (Linux AppImage, macOS .app, Windows NSIS) resolve the
 * executable and call {@link launchAndAssert}. Success means:
 *   1. the process stays alive past a startup threshold (no crash exit), and
 *   2. `mesh-client.log` under `--user-data-dir` shows `[Startup] renderer loaded:`
 *      after the final `loadURL` resolves, with no renderer-gone / failed-load /
 *      child-process-gone lines.
 *
 * Linux-specific Chromium flags (`--no-sandbox`) and `MESH_CLIENT_DISABLE_GPU`
 * stay in the Linux caller — those are not portable.
 */
import { spawn, spawnSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import path from 'path';

import { joinUnderRoot } from './lib/path-under-root.mjs';

export const LOG_FILENAME = 'mesh-client.log';
/** How long the process must stay alive to count as "booted" (ms). */
export const STARTUP_ALIVE_MS = 20_000;
/** How long to wait for the renderer-loaded log line to appear (ms). */
export const LOG_WAIT_MS = 25_000;
/** Poll interval while waiting for the log file (ms). */
export const LOG_POLL_MS = 500;
/** Grace period for a clean kill before SIGKILL (ms). */
export const KILL_GRACE_MS = 5_000;
/**
 * Extra settle after Windows taskkill before callers delete `--user-data-dir`.
 * Chromium LevelDB files (e.g. declarative_performance_observer.db) can stay
 * EBUSY briefly after the process tree exits.
 */
export const WIN32_USERDATA_SETTLE_MS = 500;
/** Keep only the tail of a child's stdio so a noisy boot cannot grow without bound. */
const STDIO_TAIL_MAX = 64 * 1024;

/**
 * Thrown by {@link fail} so callers' `finally` still removes temp dirs.
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

/**
 * True when the log shows the renderer was loaded.
 *
 * `formatLine` in `src/main/log-service.ts` writes every main-process line as
 * `[level] [main] …`, so a bare `[main]` match is true for errors and for lines
 * written before any window exists. The completion marker is logged only after
 * the final `loadURL` resolves, including a migration fallback. The earlier URL-intent
 * line and renderer console output can appear before navigation completes.
 * @param {string} logText
 */
export function logShowsStartup(logText) {
  if (typeof logText !== 'string' || logText.length === 0) return false;
  return /\[Startup\] renderer loaded:/.test(logText);
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
  return /\[main\] Renderer process gone:|\[main\] Failed to load:|\[main\] Failed to load renderer:|\[main\] renderer boot failed:|\[main\] child-process-gone:/.test(
    text,
  );
}

/**
 * Platform-neutral launch argv: redirect user data only.
 * Linux adds sandbox flags in its own `buildLaunchArgs`.
 * @param {string} userDataDir
 */
export function baseLaunchArgs(userDataDir) {
  return [`--user-data-dir=${userDataDir}`];
}

/**
 * Smoke spawns must use absolute binaries (AppRun, .app Mach-O, installers) or an allowlisted basename.
 * @param {string} command
 * @returns {string}
 */
export function assertSmokeSpawnCommand(command) {
  if (path.isAbsolute(command)) return command;
  if (command === 'node') return command;
  fail(`refusing to spawn non-absolute command: ${command}`);
}

/** @param {string} text @param {number} [max] */
export function tailText(text, max = 8192) {
  if (text.length <= max) return text;
  return text.slice(-max);
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
 * Depth-2 directory listing for timeout diagnostics (capped).
 * @param {string} dir
 * @param {number} [maxEntries=40]
 */
function listDirDepth2(dir, maxEntries = 40) {
  if (!existsSync(dir)) return `(missing) ${dir}`;
  /** @type {string[]} */
  const lines = [];
  try {
    const top = readdirSync(dir, { withFileTypes: true });
    for (const entry of top) {
      if (lines.length >= maxEntries) {
        lines.push('…');
        break;
      }
      const full = joinUnderRoot(dir, entry.name);
      if (entry.isDirectory()) {
        lines.push(`${entry.name}/`);
        try {
          const nested = readdirSync(full, { withFileTypes: true });
          for (const child of nested) {
            if (lines.length >= maxEntries) {
              lines.push('…');
              break;
            }
            const childPath = joinUnderRoot(full, child.name);
            let suffix = child.isDirectory() ? '/' : '';
            try {
              if (child.isFile()) suffix = ` (${statSync(childPath).size}b)`;
            } catch {
              // catch-no-log-ok listing best-effort
            }
            lines.push(`  ${entry.name}/${child.name}${suffix}`);
          }
        } catch {
          // catch-no-log-ok listing best-effort
        }
      } else {
        let size = '';
        try {
          size = ` (${statSync(full).size}b)`;
        } catch {
          // catch-no-log-ok listing best-effort
        }
        lines.push(`${entry.name}${size}`);
      }
    }
  } catch (e) {
    return `(unlistable) ${dir}: ${e instanceof Error ? e.message : String(e)}`;
  }
  return lines.length === 0 ? '(empty)' : lines.join('\n');
}

/**
 * Terminate the child, marking teardown as intentional so its exit is not
 * treated as a crash. Pass the shared `state` used by launchAndAssert.
 * @param {import('child_process').ChildProcess} child
 * @param {{ teardownStarted: boolean }} state
 * @param {number} killGraceMs
 */
async function killChild(child, state, killGraceMs) {
  state.teardownStarted = true;
  if (child.exitCode !== null || child.signalCode !== null) return;
  // OS-specific: Windows has no POSIX signals; kill the whole process tree so the
  // Reticulum sidecar child cannot hold the throwaway user-data dir open.
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    // Wait for Node's ChildProcess exit (and Chromium handle release) before
    // callers rmSync the throwaway user-data dir — taskkill returning is not enough.
    const killDeadline = Date.now() + killGraceMs;
    while (Date.now() < killDeadline) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      await sleepMs(100);
    }
    await sleepMs(WIN32_USERDATA_SETTLE_MS);
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // catch-no-log-ok process already exited
    return;
  }
  const termDeadline = Date.now() + killGraceMs;
  while (Date.now() < termDeadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleepMs(100);
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // catch-no-log-ok process already exited
    return;
  }
  // Wait for the SIGKILL'd child so callers do not race an alive process holding
  // userData; bound the wait so a stuck process cannot hang the smoke forever.
  const killDeadline = Date.now() + killGraceMs;
  while (Date.now() < killDeadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await sleepMs(100);
  }
  console.warn(
    `[packaged-launch-smoke] child pid ${child.pid ?? '?'} did not exit after SIGKILL within ${killGraceMs}ms`,
  );
}

/**
 * Best-effort delete of a throwaway `--user-data-dir` after launch smoke.
 * Retries Windows EBUSY/EPERM (Chromium LevelDB locks) then warns — never throws
 * after a successful boot assertion.
 *
 * @param {string} dir
 * @param {{
 *   retries?: number,
 *   delayMs?: number,
 *   label?: string,
 *   rm?: typeof rmSync,
 *   sleep?: (ms: number) => Promise<void>,
 * }} [opts]
 */
export async function rmTempDirBestEffort(dir, opts = {}) {
  const retries = opts.retries ?? 8;
  const delayMs = opts.delayMs ?? 250;
  const label = opts.label ?? 'packaged-launch-smoke';
  const rm = opts.rm ?? rmSync;
  const sleep = opts.sleep ?? sleepMs;
  let lastErr = /** @type {unknown} */ (null);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      lastErr = e;
      const code =
        e && typeof e === 'object' && 'code' in e
          ? String(/** @type {{ code?: unknown }} */ (e).code)
          : '';
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') break;
      if (attempt < retries) {
        await sleep(delayMs);
      }
    }
  }
  const detail = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.warn(`[${label}] left temp dir ${dir} (${detail})`);
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
 * failure lines. Production passes AppRun / .app Mach-O / Mesh-client.exe;
 * tests pass `node -e`.
 *
 * @param {object} opts
 * @param {string} opts.command Executable to spawn.
 * @param {string[]} [opts.args]
 * @param {string} [opts.cwd]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} opts.userDataDir
 * @param {string} [opts.label='packaged-launch-smoke'] Prefix for debug/OK lines.
 * @param {number} [opts.startupAliveMs]
 * @param {number} [opts.logWaitMs]
 * @param {number} [opts.pollMs]
 * @param {number} [opts.killGraceMs]
 */
export async function launchAndAssert({
  command,
  args = [],
  cwd,
  env = process.env,
  userDataDir,
  label = 'packaged-launch-smoke',
  startupAliveMs = STARTUP_ALIVE_MS,
  logWaitMs = LOG_WAIT_MS,
  pollMs = LOG_POLL_MS,
  killGraceMs = KILL_GRACE_MS,
}) {
  const logPath = joinUnderRoot(userDataDir, LOG_FILENAME);
  let stdioBuf = '';
  /** Sticky: renderer-failure seen in uncapped stdio (survives appendCapped trim). */
  let rendererFailureFromStdio = false;
  /** Shared teardown flag so our own SIGTERM/SIGKILL is not counted as a crash. */
  const state = { teardownStarted: false };
  /** @type {{ code: number | null, signal: NodeJS.Signals | null, error?: string } | null} */
  let crashExit = null;

  const spawnedAt = Date.now();
  const executable = assertSmokeSpawnCommand(command);
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- command validated by assertSmokeSpawnCommand (absolute path or node).
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onChunk = (d) => {
    const chunk = String(d);
    // Detect against previous buffer + chunk *before* capping so a failure line
    // followed by >STDIO_TAIL_MAX of noise is not lost from the diagnostic tail.
    if (!rendererFailureFromStdio && logShowsRendererFailure(`${stdioBuf}${chunk}`)) {
      rendererFailureFromStdio = true;
    }
    stdioBuf = appendCapped(stdioBuf, chunk);
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
  const sawRendererFailure = (logText) =>
    rendererFailureFromStdio || logShowsRendererFailure(observedText(logText));

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
      if (sawRendererFailure(logText)) {
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
            '(expected "[Startup] renderer loaded:" after a successful loadURL).\n' +
            `--- userDataDir listing (depth 2) ---\n${listDirDepth2(userDataDir)}\n` +
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
    if (sawRendererFailure(logText)) {
      fail(
        'Renderer failed to stay up (renderer-gone, failed-load, or child-process-gone).\n' +
          `--- log (last 2KB) ---\n${tailText(logText, 2048)}\n` +
          `--- stderr/stdout (last 2KB) ---\n${tailText(stdioBuf, 2048)}`,
      );
    }
  } finally {
    await killChild(child, state, killGraceMs);
  }

  console.debug(`[${label}] OK — app booted and the renderer loaded`);
}
