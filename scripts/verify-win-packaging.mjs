#!/usr/bin/env node
/**
 * Post-dist:win guard — fail CI if Windows packaging omits Mesh-client.exe or ships a
 * universal NSIS installer instead of per-arch Setup exes.
 *
 * Failure point: electron-builder universal NSIS on Windows 11 ARM can extract support
 * files but drop the main exe; split installers avoid arch-selection in NSIS.
 * Fallback: hard fail before publish so a broken Windows release never ships.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const MIN_EXE_BYTES = 50 * 1024 * 1024;
const APP_EXE = 'Mesh-client.exe';

/** @param {string} label @param {string} filePath */
function assertExe(label, filePath) {
  if (!existsSync(filePath)) {
    console.error(`[verify-win-packaging] Missing ${label}: ${filePath}`);
    process.exit(1);
  }
  const size = statSync(filePath).size;
  if (size < MIN_EXE_BYTES) {
    console.error(
      `[verify-win-packaging] ${label} too small (${size} bytes, need >= ${MIN_EXE_BYTES}): ${filePath}`,
    );
    process.exit(1);
  }
}

/** @param {string} filePath */
async function assertPeParsable(filePath) {
  const { NtExecutable } = await import('resedit');
  const data = readFileSync(filePath);
  try {
    NtExecutable.from(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[verify-win-packaging] Invalid PE after packaging: ${filePath} — ${msg}`);
    process.exit(1);
  }
}

function readVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  return packageJson.version;
}

function collectSetupInstallers(version) {
  if (!existsSync(releaseDir)) {
    console.error(`[verify-win-packaging] Missing release directory: ${releaseDir}`);
    process.exit(1);
  }

  const prefix = `Mesh-client Setup ${version}`;
  const installers = readdirSync(releaseDir).filter((name) => {
    if (name.includes('__uninstaller')) return false;
    return name === `${prefix}.exe` || name === `${prefix}-arm64.exe`;
  });

  const x64 = installers.filter((name) => !name.endsWith('-arm64.exe'));
  const arm64 = installers.filter((name) => name.endsWith('-arm64.exe'));

  if (x64.length !== 1) {
    console.error(
      `[verify-win-packaging] Expected exactly one x64 NSIS installer, found ${x64.length}: ${x64.join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  if (arm64.length !== 1) {
    console.error(
      `[verify-win-packaging] Expected exactly one arm64 NSIS installer, found ${arm64.length}: ${arm64.join(', ') || '(none)'}`,
    );
    process.exit(1);
  }
  if (installers.length !== 2) {
    console.error(
      `[verify-win-packaging] Expected two per-arch installers (no universal build), found ${installers.length}: ${installers.join(', ')}`,
    );
    process.exit(1);
  }

  return { x64: x64[0], arm64: arm64[0] };
}

async function main() {
  const version = readVersion();

  assertExe('x64 unpacked app', path.join(releaseDir, 'win-unpacked', APP_EXE));
  assertExe('arm64 unpacked app', path.join(releaseDir, 'win-arm64-unpacked', APP_EXE));

  const installers = collectSetupInstallers(version);
  assertExe('x64 NSIS installer', path.join(releaseDir, installers.x64));
  assertExe('arm64 NSIS installer', path.join(releaseDir, installers.arm64));

  await assertPeParsable(path.join(releaseDir, 'win-unpacked', APP_EXE));
  await assertPeParsable(path.join(releaseDir, 'win-arm64-unpacked', APP_EXE));

  console.debug(
    `[verify-win-packaging] OK — ${APP_EXE} in win-unpacked + win-arm64-unpacked; installers: ${installers.x64}, ${installers.arm64}`,
  );
}

main().catch((e) => {
  console.error('[verify-win-packaging] Unexpected error:', e);
  process.exit(1);
});
