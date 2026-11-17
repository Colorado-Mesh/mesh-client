#!/usr/bin/env node
/**
 * CI smoke test: silent NSIS install and assert Mesh-client.exe lands on disk.
 *
 * Failure point: NSIS can report success while dropping the main exe on WoA.
 * Fallback: exit non-zero with install log path so CI uploads diagnostics.
 *
 * With `--launch`, also boots the installed exe via the shared packaged-launch
 * smoke engine (renderer-loaded marker under a throwaway --user-data-dir).
 *
 * Diagnostics for CI upload use fixed names under `$RUNNER_TEMP`:
 *   mesh-client-install-${arch}.log
 *   mesh-client-win-${arch}-launch-diagnostics/
 *   mesh-client-7z-probe/
 * Locally (no RUNNER_TEMP), a single mkdtemp root under os.tmpdir() hosts the
 * same relative layout (CodeQL js/insecure-temporary-file).
 * Private install/probe work dirs are still deleted in `finally`.
 *
 * Usage (Windows CI only):
 *   node scripts/test-win-nsis-install.mjs --arch x64|arm64 [--probe-7z] [--launch]
 */
import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { findAppArchive } from './find-nsis-app-archive.mjs';
import { assertBundledReticulumSidecarInBundle } from './assert-bundled-reticulum-sidecar.mjs';
import {
  LaunchSmokeError,
  LOG_FILENAME,
  baseLaunchArgs,
  launchAndAssert,
  rmTempDirBestEffort,
  tailText,
} from './packaged-launch-smoke.mjs';
import { findWinSetupInstaller } from './win-setup-installer-names.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const APP_EXE = 'Mesh-client.exe';
const MIN_EXE_BYTES = 50 * 1024 * 1024;

/** @type {string | null} */
let localDiagnosticsRoot = null;

/**
 * CI: `$RUNNER_TEMP`. Local: one reusable mkdtemp under os.tmpdir().
 * @returns {string}
 */
function runnerTempRoot() {
  if (process.env.RUNNER_TEMP) {
    return process.env.RUNNER_TEMP;
  }
  if (!localDiagnosticsRoot) {
    localDiagnosticsRoot = mkdtempSync(path.join(tmpdir(), 'mesh-client-win-smoke-'));
  }
  return localDiagnosticsRoot;
}

/**
 * Copy the NSIS install log for upload-artifact after the private workDir is removed.
 * @param {'x64' | 'arm64'} arch
 * @param {string} sourcePath
 */
function persistInstallLog(arch, sourcePath) {
  if (!existsSync(sourcePath)) return;
  const dest = path.join(runnerTempRoot(), `mesh-client-install-${arch}.log`);
  try {
    copyFileSync(sourcePath, dest);
  } catch (e) {
    console.warn(
      `[test-win-nsis-install] Failed to persist install log to ${dest}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * @param {'x64' | 'arm64'} arch
 * @param {string} userDataDir
 * @param {string} message
 */
function writeLaunchDiagnostics(arch, userDataDir, message) {
  const outDir = path.join(runnerTempRoot(), `mesh-client-win-${arch}-launch-diagnostics`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'launch-error.txt'), message, 'utf-8');
  const logPath = path.join(userDataDir, LOG_FILENAME);
  if (existsSync(logPath)) {
    try {
      const text = readFileSync(logPath, 'utf-8');
      writeFileSync(path.join(outDir, LOG_FILENAME), tailText(text, 64 * 1024), 'utf-8');
    } catch {
      // catch-no-log-ok best-effort diagnostics
    }
  }
}

/** @param {string} msg */
function fail(msg) {
  console.error(`[test-win-nsis-install] ${msg}`);
  // Throw so try/finally cleanup around mkdtemp dirs still runs (process.exit skips finally).
  const err = new Error(msg);
  err.name = 'TestFail';
  throw err;
}

function readVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  return packageJson.version;
}

/** @param {string} label @param {string} filePath */
function assertExe(label, filePath) {
  if (!existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }
  const size = statSync(filePath).size;
  if (size < MIN_EXE_BYTES) {
    fail(`${label} too small (${size} bytes, need >= ${MIN_EXE_BYTES}): ${filePath}`);
  }
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    fail(`Failed to run ${cmd}: ${result.error.message}`);
  }
  return result.status ?? 1;
}

/** @param {string} logLabel @param {string} dirPath @param {number} [maxDepth] */
function dumpDir(logLabel, dirPath, maxDepth = 1) {
  console.error(`[test-win-nsis-install] --- ${logLabel}: ${dirPath} ---`);
  if (!existsSync(dirPath)) {
    console.error('  (path does not exist)');
    return;
  }

  /** @param {string} dir @param {string} indent @param {number} depth */
  function list(dir, indent, depth) {
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          console.error(`${indent}${entry.name}/`);
          if (depth < maxDepth) {
            list(full, `${indent}  `, depth + 1);
          }
        } else {
          console.error(`${indent}${entry.name} (${statSync(full).size} bytes)`);
        }
      }
    } catch (e) {
      console.error(`${indent}(listing failed: ${e})`);
    }
  }

  list(dirPath, '  ', 0);
}

/** @param {string} installerPath @param {string} outDir @param {'x64' | 'arm64'} arch */
function probe7zExtract(installerPath, outDir, arch) {
  if (process.platform !== 'win32') {
    console.debug('[test-win-nsis-install] Skipping --probe-7z (not Windows)');
    return;
  }

  const sevenZ = 'C:\\Program Files\\7-Zip\\7z.exe';
  if (!existsSync(sevenZ)) {
    fail(`--probe-7z requires 7-Zip at ${sevenZ}`);
  }

  // Caller supplies a unique mkdtemp directory — do not delete/recreate it.
  console.debug(`[test-win-nsis-install] Probing 7z extract from installer → ${outDir}`);
  const extractInstaller = run(sevenZ, ['x', `-o${outDir}`, installerPath, '-y']);
  if (extractInstaller !== 0) {
    fail(`7z extract from installer failed (exit ${extractInstaller})`);
  }

  const appArchivePath = findAppArchive(outDir);
  if (!appArchivePath) {
    dumpDir('probe-7z output', outDir, 2);
    fail('No app*.7z or app*.zip found inside installer after 7z extract');
  }

  const archiveDir = path.join(outDir, 'app-payload');
  mkdirSync(archiveDir, { recursive: true });
  const appArchiveName = path.basename(appArchivePath);
  const extractArchive = run(sevenZ, ['x', `-o${archiveDir}`, appArchivePath, '-y']);
  if (extractArchive !== 0) {
    fail(`7z extract from ${appArchiveName} failed (exit ${extractArchive})`);
  }

  const exePath = path.join(archiveDir, APP_EXE);
  assertExe(`7z probe ${APP_EXE}`, exePath);
  assertBundledReticulumSidecarInBundle({
    label: `7z probe ${arch} Reticulum sidecar`,
    platform: 'win32',
    bundleRoot: archiveDir,
    fail,
    expectedArch: arch,
  });
  console.debug(
    `[test-win-nsis-install] OK — ${APP_EXE} + Reticulum sidecar present after 7z probe (${appArchiveName})`,
  );
}

/**
 * @param {'x64' | 'arm64'} arch
 * @param {boolean} probe7z
 * @param {boolean} launch
 */
async function main(arch, probe7z, launch) {
  if (process.platform !== 'win32') {
    console.debug('[test-win-nsis-install] Skipping on non-Windows host');
    return;
  }

  const version = readVersion();
  if (!existsSync(releaseDir)) {
    fail(`Missing release directory: ${releaseDir}`);
  }
  /** @type {string} */
  let installer;
  try {
    installer = findWinSetupInstaller(version, arch, readdirSync(releaseDir));
  } catch (e) {
    dumpDir('release dir (installer missing)', releaseDir, 2);
    fail(e instanceof Error ? e.message : String(e));
  }
  const installerPath = path.join(releaseDir, installer);

  if (probe7z) {
    const probeDir = mkdtempSync(path.join(tmpdir(), 'mesh-client-7z-probe-'));
    try {
      probe7zExtract(installerPath, probeDir, arch);
    } catch (e) {
      // Best-effort: fixed relative layout under runnerTempRoot for CI upload.
      try {
        const probeUploadDir = path.join(runnerTempRoot(), 'mesh-client-7z-probe');
        mkdirSync(probeUploadDir, { recursive: true });
        writeFileSync(
          path.join(probeUploadDir, 'probe-error.txt'),
          e instanceof Error ? e.message : String(e),
          'utf-8',
        );
      } catch {
        // catch-no-log-ok diagnostics best-effort
      }
      throw e;
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    fail('LOCALAPPDATA is not set');
  }
  const instDir = path.join(localAppData, 'Programs', 'Mesh-client');
  const workDir = mkdtempSync(path.join(tmpdir(), 'mesh-client-install-'));
  const installLogName = `mesh-client-install-${arch}.log`;
  try {
    const logPath = path.join(workDir, installLogName);

    rmSync(instDir, { recursive: true, force: true });

    console.debug(`[test-win-nsis-install] Installing ${installer} → ${instDir}`);
    const installStatus = run(installerPath, ['/S', `/LOG=${logPath}`]);
    // Always persist for CI upload (success or failure); workDir is deleted in finally.
    persistInstallLog(arch, logPath);

    if (installStatus !== 0) {
      if (existsSync(logPath)) {
        console.error('[test-win-nsis-install] --- NSIS install log ---');
        console.error(readFileSync(logPath, 'utf-8'));
      }
      dumpDir('install dir after failed installer', instDir);
      fail(`Installer exited ${installStatus}`);
    }

    const exePath = path.join(instDir, APP_EXE);
    if (!existsSync(exePath)) {
      if (existsSync(logPath)) {
        console.error('[test-win-nsis-install] --- NSIS install log ---');
        console.error(readFileSync(logPath, 'utf-8'));
      }
      dumpDir('install dir (exe missing)', instDir);
      fail(`${APP_EXE} missing after silent install (log: ${logPath})`);
    }

    assertExe(`installed ${APP_EXE}`, exePath);
    assertBundledReticulumSidecarInBundle({
      label: `installed ${arch} Reticulum sidecar`,
      platform: 'win32',
      bundleRoot: instDir,
      fail,
      expectedArch: arch,
    });
    console.debug(
      `[test-win-nsis-install] OK — ${arch} NSIS install left ${exePath} with bundled Reticulum sidecar`,
    );

    if (launch) {
      const userDataDir = mkdtempSync(path.join(tmpdir(), `mesh-client-userdata-win-${arch}-`));
      try {
        try {
          await launchAndAssert({
            label: 'test-win-nsis-install',
            command: exePath,
            args: baseLaunchArgs(userDataDir),
            cwd: instDir,
            env: { ...process.env },
            userDataDir,
          });
          console.debug(
            `[test-win-nsis-install] OK — installed ${APP_EXE} boots and loads the renderer`,
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          writeLaunchDiagnostics(arch, userDataDir, message);
          throw e;
        }
      } finally {
        // Chromium can keep LevelDB files EBUSY after taskkill; do not fail a green launch.
        await rmTempDirBestEffort(userDataDir, { label: 'test-win-nsis-install' });
      }
    }
  } finally {
    await rmTempDirBestEffort(workDir, { label: 'test-win-nsis-install' });
  }
}

const args = process.argv.slice(2);
const archArg =
  args.find((a) => a.startsWith('--arch='))?.split('=')[1] ??
  (args.includes('--arch') ? args[args.indexOf('--arch') + 1] : undefined);
const probe7z = args.includes('--probe-7z');
const launch = args.includes('--launch');

if (archArg !== 'x64' && archArg !== 'arm64') {
  fail('Usage: node scripts/test-win-nsis-install.mjs --arch x64|arm64 [--probe-7z] [--launch]');
}

main(archArg, probe7z, launch).catch((e) => {
  if ((e instanceof Error && e.name === 'TestFail') || e instanceof LaunchSmokeError) {
    if (e instanceof LaunchSmokeError) {
      console.error(`[test-win-nsis-install] ${e.message}`);
    }
    process.exit(1);
  }
  console.error('[test-win-nsis-install] Unexpected error:', e);
  process.exit(1);
});
