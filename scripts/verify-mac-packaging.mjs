#!/usr/bin/env node
/**
 * Post-dist:mac guard — fail CI if macOS packaging omits the app binary or release artifacts.
 *
 * Failure point: electron-builder can emit empty or stub bundles on misconfigured runners.
 * Fallback: hard fail before artifact upload so a broken macOS build never ships.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const APP_NAME = 'Mesh-client';
const MACOS_LAUNCHER = path.join('Contents', 'MacOS', APP_NAME);
const ELECTRON_FRAMEWORK_BINARY = path.join(
  'Contents',
  'Frameworks',
  'Electron Framework.framework',
  'Versions',
  'A',
  'Electron Framework',
);
/** Thin Mach-O launcher in Contents/MacOS (Electron 30+); real runtime is in the framework. */
const MIN_LAUNCHER_BYTES = 1024;
const MIN_FRAMEWORK_BYTES = 50 * 1024 * 1024;
const MIN_DMG_BYTES = 1024 * 1024;
const MIN_ZIP_BYTES = 1024 * 1024;

/** @param {string} msg */
function fail(msg) {
  console.error(`[verify-mac-packaging] ${msg}`);
  process.exit(1);
}

/** @param {string} label @param {string} filePath @param {number} minBytes */
function assertMinSize(label, filePath, minBytes) {
  if (!existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }
  const size = statSync(filePath).size;
  if (size < minBytes) {
    fail(`${label} too small (${size} bytes, need >= ${minBytes}): ${filePath}`);
  }
}

/** @param {string} dir @param {string[]} found */
function collectAppBundles(dir, found) {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.endsWith('.app')) {
        found.push(full);
      } else {
        collectAppBundles(full, found);
      }
    }
  }
}

function main() {
  if (!existsSync(releaseDir)) {
    fail(`Missing release directory: ${releaseDir}`);
  }

  /** @type {string[]} */
  const appBundles = [];
  collectAppBundles(releaseDir, appBundles);
  if (appBundles.length === 0) {
    fail(`No ${APP_NAME}.app bundle found under ${releaseDir}`);
  }

  let validatedBundle = false;
  for (const bundle of appBundles) {
    const launcherPath = path.join(bundle, MACOS_LAUNCHER);
    const frameworkPath = path.join(bundle, ELECTRON_FRAMEWORK_BINARY);
    if (existsSync(launcherPath) && existsSync(frameworkPath)) {
      const bundleName = path.basename(bundle);
      assertMinSize(`macOS launcher in ${bundleName}`, launcherPath, MIN_LAUNCHER_BYTES);
      assertMinSize(`Electron Framework in ${bundleName}`, frameworkPath, MIN_FRAMEWORK_BYTES);
      validatedBundle = true;
      break;
    }
  }
  if (!validatedBundle) {
    fail(
      `No ${MACOS_LAUNCHER} + ${ELECTRON_FRAMEWORK_BINARY} found in any .app bundle under ${releaseDir}`,
    );
  }

  const releaseFiles = readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  const dmgs = releaseFiles.filter((n) => n.endsWith('.dmg'));
  const zips = releaseFiles.filter((n) => n.endsWith('.zip'));

  if (dmgs.length === 0) {
    fail(`No .dmg artifacts in ${releaseDir}`);
  }
  if (zips.length === 0) {
    fail(`No .zip artifacts in ${releaseDir}`);
  }

  for (const dmg of dmgs) {
    assertMinSize(`dmg ${dmg}`, path.join(releaseDir, dmg), MIN_DMG_BYTES);
  }
  for (const zip of zips) {
    assertMinSize(`zip ${zip}`, path.join(releaseDir, zip), MIN_ZIP_BYTES);
  }

  const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
  console.debug(
    `[verify-mac-packaging] OK — ${APP_NAME}.app launcher + Electron Framework + ${dmgs.length} dmg, ${zips.length} zip (v${version})`,
  );
}

try {
  main();
} catch (e) {
  console.error('[verify-mac-packaging] Unexpected error:', e);
  process.exit(1);
}
