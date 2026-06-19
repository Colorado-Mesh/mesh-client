#!/usr/bin/env node
/**
 * CI smoke test: silent NSIS install and assert Mesh-client.exe lands on disk.
 *
 * Failure point: NSIS can report success while dropping the main exe on WoA.
 * Fallback: exit non-zero with install log path so CI uploads diagnostics.
 *
 * Usage (Windows CI only):
 *   node scripts/test-win-nsis-install.mjs --arch x64
 *   node scripts/test-win-nsis-install.mjs --arch arm64 [--probe-7z]
 */
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { findAppArchive } from './find-nsis-app-archive.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const APP_EXE = 'Mesh-client.exe';
const MIN_EXE_BYTES = 50 * 1024 * 1024;

/** @param {string} msg */
function fail(msg) {
  console.error(`[test-win-nsis-install] ${msg}`);
  process.exit(1);
}

function readVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  return packageJson.version;
}

/** @param {'x64' | 'arm64'} arch */
function installerName(version, arch) {
  const base = `Mesh-client Setup ${version}`;
  return arch === 'arm64' ? `${base}-arm64.exe` : `${base}.exe`;
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

/** @param {string} installerPath @param {string} outDir */
function probe7zExtract(installerPath, outDir) {
  if (process.platform !== 'win32') {
    console.debug('[test-win-nsis-install] Skipping --probe-7z (not Windows)');
    return;
  }

  const sevenZ = 'C:\\Program Files\\7-Zip\\7z.exe';
  if (!existsSync(sevenZ)) {
    fail(`--probe-7z requires 7-Zip at ${sevenZ}`);
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

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
  console.debug(
    `[test-win-nsis-install] OK — ${APP_EXE} present after 7z probe (${appArchiveName})`,
  );
}

/** @param {'x64' | 'arm64'} arch @param {boolean} probe7z */
function main(arch, probe7z) {
  if (process.platform !== 'win32') {
    console.debug('[test-win-nsis-install] Skipping on non-Windows host');
    return;
  }

  const version = readVersion();
  const installer = installerName(version, arch);
  const installerPath = path.join(releaseDir, installer);
  if (!existsSync(installerPath)) {
    fail(`Installer not found: ${installerPath}`);
  }

  if (probe7z) {
    probe7zExtract(installerPath, path.join(tmpdir(), 'mesh-client-7z-probe'));
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    fail('LOCALAPPDATA is not set');
  }
  const instDir = path.join(localAppData, 'Programs', 'Mesh-client');
  const logPath = path.join(tmpdir(), `mesh-client-install-${arch}.log`);

  rmSync(instDir, { recursive: true, force: true });
  rmSync(logPath, { force: true });

  console.debug(`[test-win-nsis-install] Installing ${installer} → ${instDir}`);
  const installStatus = run(installerPath, ['/S', `/LOG=${logPath}`]);
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
  console.debug(`[test-win-nsis-install] OK — ${arch} NSIS install left ${exePath}`);
}

const args = process.argv.slice(2);
const archArg =
  args.find((a) => a.startsWith('--arch='))?.split('=')[1] ??
  (args.includes('--arch') ? args[args.indexOf('--arch') + 1] : undefined);
const probe7z = args.includes('--probe-7z');

if (archArg !== 'x64' && archArg !== 'arm64') {
  fail('Usage: node scripts/test-win-nsis-install.mjs --arch x64|arm64 [--probe-7z]');
}

try {
  main(archArg, probe7z);
} catch (e) {
  console.error('[test-win-nsis-install] Unexpected error:', e);
  process.exit(1);
}
