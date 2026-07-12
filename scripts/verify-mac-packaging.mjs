#!/usr/bin/env node
/**
 * Post-dist:mac guard — fail CI if macOS packaging omits the app binary or release artifacts.
 *
 * Failure point: electron-builder can emit empty or stub bundles on misconfigured runners.
 * Fallback: hard fail before artifact upload so a broken macOS build never ships.
 *
 * CI smoke path (artifact download): validates .app from shipped ZIP (ditto) and DMG (hdiutil).
 * Local dist:mac path: validates on-disk .app plus DMG mount; skips ZIP extract when .app exists.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { assertBundledReticulumSidecarInBundle } from './assert-bundled-reticulum-sidecar.mjs';

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
const ELECTRON_FRAMEWORK_ROOT = path.join('Contents', 'Frameworks', 'Electron Framework.framework');
const VERIFY_ZIP_EXTRACT_DIR = path.join(releaseDir, '.verify-mac-extract');
const VERIFY_DMG_MOUNT_DIR = path.join(releaseDir, '.verify-mac-dmg-mount');

/** Thin Mach-O launcher in Contents/MacOS (Electron 30+); real runtime is in the framework. */
const MIN_LAUNCHER_BYTES = 1024;
const MIN_FRAMEWORK_BYTES = 50 * 1024 * 1024;
const MIN_DMG_BYTES = 1024 * 1024;
const MIN_ZIP_BYTES = 1024 * 1024;

/** Expected validation failure — printed without a stack trace at top level. */
class VerificationFailure extends Error {}

/**
 * Throws instead of calling process.exit so `finally` cleanup (e.g. detachDmgMount)
 * still runs; the top-level handler prints the message and exits 1.
 * @param {string} msg
 * @returns {never}
 */
function fail(msg) {
  throw new VerificationFailure(msg);
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

/**
 * @param {string} dir
 * @param {string} ext e.g. '.dmg' or '.zip'
 * @returns {string[]}
 */
function collectArchives(dir, ext) {
  /** @type {string[]} */
  const rootMatches = [];
  /** @type {string[]} */
  const nestedMatches = [];

  /** @param {string} scanDir */
  function walk(scanDir) {
    if (!existsSync(scanDir)) {
      return;
    }
    for (const entry of readdirSync(scanDir, { withFileTypes: true })) {
      const full = path.join(scanDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        if (scanDir === releaseDir) {
          rootMatches.push(full);
        } else {
          nestedMatches.push(full);
        }
      }
    }
  }

  walk(dir);
  return rootMatches.length > 0 ? rootMatches : nestedMatches;
}

/**
 * Largest archive wins (electron-builder can emit per-arch variants).
 * Callers guarantee a non-empty list (main() fails early when none exist).
 * @param {string[]} archives @returns {string}
 */
function pickPrimaryArchive(archives) {
  return archives
    .map((filePath) => ({ filePath, size: statSync(filePath).size }))
    .reduce((largest, current) => (current.size > largest.size ? current : largest)).filePath;
}

/** @param {string} bundleRoot @param {string} label */
function assertFrameworkSymlinks(bundleRoot, label) {
  const frameworkRoot = path.join(bundleRoot, ELECTRON_FRAMEWORK_ROOT);
  const currentLink = path.join(frameworkRoot, 'Versions', 'Current');
  const rootBinaryLink = path.join(frameworkRoot, 'Electron Framework');

  for (const linkPath of [currentLink, rootBinaryLink]) {
    if (!existsSync(linkPath)) {
      fail(`Missing ${label} framework entry: ${linkPath}`);
    }
    if (!lstatSync(linkPath).isSymbolicLink()) {
      fail(
        `${label} must be a symlink (upload-artifact dereferences break Electron bundles): ${linkPath}`,
      );
    }
  }
}

/** @param {string} bundleRoot @param {string} sourceLabel */
function validateAppBundle(bundleRoot, sourceLabel) {
  const bundleName = path.basename(bundleRoot);
  const label = `${sourceLabel} ${bundleName}`;
  const launcherPath = path.join(bundleRoot, MACOS_LAUNCHER);
  const frameworkPath = path.join(bundleRoot, ELECTRON_FRAMEWORK_BINARY);

  if (!existsSync(launcherPath) || !existsSync(frameworkPath)) {
    fail(`No ${MACOS_LAUNCHER} + ${ELECTRON_FRAMEWORK_BINARY} in ${label} at ${bundleRoot}`);
  }

  assertFrameworkSymlinks(bundleRoot, label);
  assertMinSize(`macOS launcher in ${label}`, launcherPath, MIN_LAUNCHER_BYTES);
  assertMinSize(`Electron Framework in ${label}`, frameworkPath, MIN_FRAMEWORK_BYTES);
  assertBundledReticulumSidecarInBundle({
    label: `bundled Reticulum sidecar in ${label}`,
    platform: 'darwin',
    bundleRoot,
    fail,
  });
}

/** @param {string} bundleRoot @returns {boolean} */
function isCompleteAppBundle(bundleRoot) {
  const launcherPath = path.join(bundleRoot, MACOS_LAUNCHER);
  const frameworkPath = path.join(bundleRoot, ELECTRON_FRAMEWORK_BINARY);
  return existsSync(launcherPath) && existsSync(frameworkPath);
}

/** @param {string} searchRoot @returns {string | null} */
function findCompleteAppBundle(searchRoot) {
  /** @type {string[]} */
  const bundles = [];
  collectAppBundles(searchRoot, bundles);
  return bundles.find((bundle) => isCompleteAppBundle(bundle)) ?? null;
}

/** @param {string} command @param {string[]} args @param {string} failLabel */
function runCommand(command, args, failLabel) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    fail(failLabel);
  }
}

/** @param {string} zipPath @returns {string} */
function extractZipToTemp(zipPath) {
  rmSync(VERIFY_ZIP_EXTRACT_DIR, { recursive: true, force: true });
  mkdirSync(VERIFY_ZIP_EXTRACT_DIR, { recursive: true });
  // ditto -xk preserves symlinks inside electron-builder zips.
  runCommand(
    'ditto',
    ['-xk', zipPath, VERIFY_ZIP_EXTRACT_DIR],
    `Failed to extract zip with ditto: ${zipPath}`,
  );

  const bundle = findCompleteAppBundle(VERIFY_ZIP_EXTRACT_DIR);
  if (!bundle) {
    fail(`No complete ${APP_NAME}.app found inside zip: ${zipPath}`);
  }
  return bundle;
}

/** @param {string} dmgPath @param {(bundleRoot: string) => void} validate */
function mountDmgAndValidate(dmgPath, validate) {
  rmSync(VERIFY_DMG_MOUNT_DIR, { recursive: true, force: true });
  mkdirSync(VERIFY_DMG_MOUNT_DIR, { recursive: true });

  // hdiutil attach: mount dmg read-only for bundle inspection.
  runCommand(
    'hdiutil',
    ['attach', '-nobrowse', '-readonly', '-mountpoint', VERIFY_DMG_MOUNT_DIR, dmgPath],
    `Failed to mount dmg with hdiutil: ${dmgPath}`,
  );

  try {
    const bundle = findCompleteAppBundle(VERIFY_DMG_MOUNT_DIR);
    if (!bundle) {
      fail(`No complete ${APP_NAME}.app found inside dmg: ${dmgPath}`);
    }
    validate(bundle);
  } finally {
    detachDmgMount();
  }
}

function detachDmgMount() {
  if (!existsSync(VERIFY_DMG_MOUNT_DIR)) {
    return;
  }
  const quiet = spawnSync('hdiutil', ['detach', VERIFY_DMG_MOUNT_DIR, '-quiet'], {
    stdio: 'inherit',
  });
  if (quiet.error || quiet.status !== 0) {
    console.warn(
      '[verify-mac-packaging] hdiutil detach failed, retrying with -force:',
      quiet.error,
    );
    const forced = spawnSync('hdiutil', ['detach', '-force', VERIFY_DMG_MOUNT_DIR], {
      stdio: 'inherit',
    });
    if (forced.error || forced.status !== 0) {
      const msg = `[verify-mac-packaging] hdiutil detach -force failed: ${forced.error ?? forced.status}`;
      if (process.env.CI === 'true') {
        fail(msg);
      }
      console.error(msg);
    }
  }
}

function main() {
  try {
    if (!existsSync(releaseDir)) {
      fail(`Missing release directory: ${releaseDir}`);
    }

    const dmgArchives = collectArchives(releaseDir, '.dmg');
    const zipArchives = collectArchives(releaseDir, '.zip');

    if (dmgArchives.length === 0) {
      fail(`No .dmg artifacts under ${releaseDir}`);
    }
    if (zipArchives.length === 0) {
      fail(`No .zip artifacts under ${releaseDir}`);
    }

    for (const dmgPath of dmgArchives) {
      assertMinSize(`dmg ${path.basename(dmgPath)}`, dmgPath, MIN_DMG_BYTES);
    }
    for (const zipPath of zipArchives) {
      assertMinSize(`zip ${path.basename(zipPath)}`, zipPath, MIN_ZIP_BYTES);
    }

    /** @type {string[]} */
    const validatedSources = [];

    /** @type {string[]} */
    const onDiskBundles = [];
    collectAppBundles(releaseDir, onDiskBundles);
    const directBundle = onDiskBundles.find((bundle) => isCompleteAppBundle(bundle));

    if (directBundle) {
      validateAppBundle(directBundle, 'direct');
      validatedSources.push('direct');
    }

    if (process.env.CI === 'true' || !directBundle) {
      const zipBundle = extractZipToTemp(pickPrimaryArchive(zipArchives));
      validateAppBundle(zipBundle, 'zip');
      validatedSources.push('zip');
    }

    mountDmgAndValidate(pickPrimaryArchive(dmgArchives), (dmgBundle) => {
      validateAppBundle(dmgBundle, 'dmg');
      validatedSources.push('dmg');
    });

    const version = readPackageVersion();
    console.debug(
      `[verify-mac-packaging] OK — validated via ${validatedSources.join(', ')}; ${dmgArchives.length} dmg, ${zipArchives.length} zip (v${version})`,
    );
  } finally {
    rmSync(VERIFY_ZIP_EXTRACT_DIR, { recursive: true, force: true });
    rmSync(VERIFY_DMG_MOUNT_DIR, { recursive: true, force: true });
  }
}

/** @returns {string} */
function readPackageVersion() {
  try {
    const raw = readFileSync(path.join(projectRoot, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

try {
  const isDirectRun =
    process.argv[1] &&
    path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
  if (isDirectRun) {
    main();
  }
} catch (e) {
  if (e instanceof VerificationFailure) {
    console.error(`[verify-mac-packaging] ${e.message}`);
  } else {
    console.error('[verify-mac-packaging] Unexpected error:', e);
  }
  process.exit(1);
}

export {
  assertFrameworkSymlinks,
  collectAppBundles,
  collectArchives,
  detachDmgMount,
  fail,
  isCompleteAppBundle,
  pickPrimaryArchive,
  VerificationFailure,
};
