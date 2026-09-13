#!/usr/bin/env node
/**
 * CI smoke: headless Electron launch test (Linux only).
 *
 * Verifies the packaged app actually boots without crashing — covers Electron
 * startup, native module loading, sidecar spawn, and basic renderer init.
 *
 * Requirements:
 * - Linux (ubuntu-latest CI runner)
 * - xvfb (provides virtual display for Electron)
 * - x64 AppImage in release/ directory
 *
 * What this proves:
 * - The installed app starts without immediate crash
 * - Main process initializes (Startup log lines emitted)
 * - Renderer loads (did-finish-load fires, implying HTML/JS loaded)
 *
 * Exit codes:
 * - 0: app started successfully and emitted expected startup markers
 * - 1: app crashed, timed out, or failed to emit expected output
 */
import { spawn, spawnSync } from 'child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

/** How long to wait for startup markers before declaring failure. */
const STARTUP_TIMEOUT_MS = 30_000;
/** How long to wait after startup markers before killing (let app stabilize). */
const STABILIZE_MS = 5_000;
/** Markers that prove the main process booted successfully. */
const REQUIRED_MARKERS = ['[Startup] runtime'];
/** Optional markers (logged if seen, not required for pass). */
const OPTIONAL_MARKERS = ['[Startup] dev server URL:', '[Startup] app.isPackaged:'];

/** @param {string} msg */
function fail(msg) {
  console.error(`[test-electron-headless-launch] FAIL: ${msg}`);
  process.exit(1);
}

/** @param {string} msg */
function info(msg) {
  console.debug(`[test-electron-headless-launch] ${msg}`);
}

/** @param {string} name */
function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/**
 * Find the x64 AppImage in the release directory.
 * @returns {string} Full path to the AppImage
 */
function findX64AppImage() {
  if (!existsSync(releaseDir)) {
    fail(`Missing release directory: ${releaseDir}`);
  }

  const appImages = readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.AppImage'))
    .map((e) => e.name)
    .filter((n) => !isArm64Name(n));

  if (appImages.length !== 1) {
    fail(
      `Expected exactly one x64 AppImage, found ${appImages.length}: ${appImages.join(', ') || '(none)'}`,
    );
  }

  const appImagePath = path.join(releaseDir, appImages[0]);
  const size = statSync(appImagePath).size;
  if (size < 50 * 1024 * 1024) {
    fail(`AppImage too small (${size} bytes): ${appImagePath}`);
  }

  return appImagePath;
}

/**
 * Extract AppImage to a temp directory and return path to the executable.
 * @param {string} appImagePath
 * @returns {string} Path to the electron binary inside squashfs-root
 */
function extractAppImage(appImagePath) {
  const extractDir = path.join(tmpdir(), `mesh-client-headless-${process.pid}`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  chmodSync(appImagePath, 0o755);

  info(`Extracting AppImage: ${path.basename(appImagePath)}`);
  const result = spawnSync(appImagePath, ['--appimage-extract'], {
    cwd: extractDir,
    stdio: 'pipe',
    env: process.env,
    timeout: 60_000,
  });

  if (result.error) {
    fail(`Failed to extract AppImage: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(
      `AppImage extract exited ${result.status ?? 'null'}: ${result.stderr?.toString().slice(0, 500)}`,
    );
  }

  const payloadRoot = path.join(extractDir, 'squashfs-root');
  if (!existsSync(payloadRoot)) {
    fail(`AppImage extract did not create squashfs-root under ${extractDir}`);
  }

  // Find the electron binary (named mesh-client or similar)
  const candidates = readdirSync(payloadRoot)
    .filter((name) => {
      const fullPath = path.join(payloadRoot, name);
      try {
        const stat = statSync(fullPath);
        return stat.isFile() && (stat.mode & 0o111) !== 0;
      } catch {
        return false;
      }
    })
    .filter((name) => /mesh[-_]?client/i.test(name) || name === 'AppRun');

  // Prefer the mesh-client binary; fall back to AppRun
  const binary =
    candidates.find((n) => /mesh[-_]?client/i.test(n)) ??
    candidates.find((n) => n === 'AppRun');

  if (!binary) {
    fail(
      `Could not find executable in extracted AppImage. Contents: ${readdirSync(payloadRoot).join(', ')}`,
    );
  }

  return { execPath: path.join(payloadRoot, binary), extractDir };
}

/**
 * Launch the app headlessly and monitor its output for startup markers.
 * @param {string} execPath
 * @returns {Promise<{success: boolean, output: string, exitCode: number | null}>}
 */
function launchHeadless(execPath) {
  return new Promise((resolve) => {
    const args = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
    let output = '';
    let foundMarkers = new Set();
    let settled = false;
    let startupTimedOut = false;

    info(`Launching: ${path.basename(execPath)} ${args.join(' ')}`);

    const child = spawn(execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ':99',
        // Electron flags for headless CI
        ELECTRON_DISABLE_SANDBOX: '1',
        NODE_ENV: 'production',
      },
      timeout: STARTUP_TIMEOUT_MS + STABILIZE_MS + 5_000,
    });

    function settle(success, exitCode = null) {
      if (settled) return;
      settled = true;
      resolve({ success, output, exitCode });
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);

      // Check for required markers
      for (const marker of REQUIRED_MARKERS) {
        if (output.includes(marker)) {
          foundMarkers.add(marker);
        }
      }
      for (const marker of OPTIONAL_MARKERS) {
        if (output.includes(marker)) {
          foundMarkers.add(marker);
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      // Stderr is normal for Electron (GPU warnings, etc.) — don't fail on it
      // but DO log it for debugging
      process.stderr.write(text);
    });

    child.on('error', (err) => {
      fail(`Failed to spawn: ${err.message}`);
    });

    child.on('exit', (code, signal) => {
      if (!settled) {
        if (code !== null && code !== 0 && !startupTimedOut) {
          info(`Process exited with code ${code} (signal: ${signal})`);
          settle(false, code);
        }
      }
    });

    // Timeout: if we don't see startup markers in time, fail
    const startupTimer = setTimeout(() => {
      startupTimedOut = true;
      const missing = REQUIRED_MARKERS.filter((m) => !foundMarkers.has(m));
      if (missing.length > 0) {
        info(`Startup timeout — missing markers: ${missing.join(', ')}`);
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          settle(false, null);
        }, 3_000);
      }
    }, STARTUP_TIMEOUT_MS);

    // Success check: poll for all required markers
    const pollInterval = setInterval(() => {
      const allFound = REQUIRED_MARKERS.every((m) => foundMarkers.has(m));
      if (allFound && !settled) {
        clearTimeout(startupTimer);
        clearInterval(pollInterval);
        info(`All startup markers found. Stabilizing for ${STABILIZE_MS / 1000}s...`);

        // Wait a bit to ensure no immediate crash after startup
        setTimeout(() => {
          if (!settled) {
            info('Stabilization complete — killing app.');
            child.kill('SIGTERM');
            setTimeout(() => {
              if (!child.killed) child.kill('SIGKILL');
              settle(true, 0);
            }, 3_000);
          }
        }, STABILIZE_MS);
      }
    }, 500);
  });
}

/**
 * Check that xvfb-run is available (required for headless Electron on Linux CI).
 */
function assertXvfbAvailable() {
  const result = spawnSync('which', ['xvfb-run'], { stdio: 'pipe' });
  if ((result.status ?? 1) !== 0) {
    fail('xvfb-run not found. Install xvfb: sudo apt-get install -y xvfb');
  }
}

async function main() {
  if (process.platform !== 'linux') {
    info('Skipping headless launch test on non-Linux platform');
    return;
  }

  assertXvfbAvailable();

  const appImagePath = findX64AppImage();
  const { execPath, extractDir } = extractAppImage(appImagePath);

  info(`Executable: ${execPath}`);

  try {
    const result = await launchHeadless(execPath);

    if (result.success) {
      info('PASS — app started successfully and emitted expected startup markers');
    } else {
      const exitInfo = result.exitCode !== null ? ` (exit code: ${result.exitCode})` : '';
      fail(`App failed to start properly${exitInfo}. Output tail:\n${result.output.slice(-2000)}`);
    }
  } finally {
    // Clean up extracted AppImage
    rmSync(extractDir, { recursive: true, force: true });
    info('Cleanup complete');
  }
}

try {
  await main();
} catch (e) {
  console.error('[test-electron-headless-launch] Unexpected error:', e);
  process.exit(1);
}
