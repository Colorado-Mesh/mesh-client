#!/usr/bin/env node
/**
 * Post-dist:mac guard — fail CI if macOS packaging omits the app binary or release artifacts.
 *
 * Failure point: electron-builder can emit empty or stub bundles on misconfigured runners.
 * Fallback: hard fail before artifact upload so a broken macOS build never ships.
 *
 * CI smoke path (artifact download): validates .app from shipped ZIP (ditto) and DMG (hdiutil).
 * Local dist:mac path: validates on-disk .app plus every ZIP extract and DMG mount.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import path from 'path';
import { assertBundledReticulumSidecarInBundle } from './assert-bundled-reticulum-sidecar.mjs';
import {
  MACOS_DMG_NOTICE_NAME,
  stageMacosInstallNoticeReleaseAsset,
} from './macos-install-notice.mjs';

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

/** Electron sibling frameworks required at launch (auto-update stack). */
const SIBLING_FRAMEWORKS = [
  { dir: 'Squirrel.framework', binary: 'Squirrel', minBytes: 1024 },
  { dir: 'Mantle.framework', binary: 'Mantle', minBytes: 1024 },
  { dir: 'ReactiveObjC.framework', binary: 'ReactiveObjC', minBytes: 1024 },
];

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
 * Largest archive wins (kept for unit tests / callers that need a single pick).
 * Callers guarantee a non-empty list (main() fails early when none exist).
 * @param {string[]} archives @returns {string}
 */
function pickPrimaryArchive(archives) {
  const sized = archives.map((filePath) => ({ filePath, size: statSync(filePath).size }));
  return sized.reduce(
    (largest, current) => (current.size > largest.size ? current : largest),
    sized[0],
  ).filePath;
}

/** @typedef {'x64' | 'arm64' | 'universal' | 'unknown'} MacArchiveArch */

/**
 * Classify a macOS release archive by path or electron-builder file name.
 * @param {string} filePath
 * @returns {MacArchiveArch}
 */
function classifyMacArchiveArch(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(normalized);
  if (normalized.includes('/mac-arm64/') || /(^|[^a-z0-9])arm64([^a-z0-9]|$)/.test(base)) {
    return 'arm64';
  }
  if (normalized.includes('/mac-x64/') || /(^|[^a-z0-9])x64([^a-z0-9]|$)/.test(base)) {
    return 'x64';
  }
  if (normalized.includes('/mac-universal/') || base.includes('universal')) {
    return 'universal';
  }
  // electron-builder may omit `-x64` for the Intel default artifact name.
  return 'unknown';
}

/**
 * Fail unless both Intel (x64) and Apple Silicon (arm64) archives are present.
 * Unscoped names count as x64 when an arm64 sibling exists.
 * @param {string[]} archives
 * @param {string} [formatLabel='archives'] e.g. `.dmg` or `.zip`
 */
function assertDualArchMacArchives(archives, formatLabel = 'archives') {
  /** @type {Record<MacArchiveArch, string[]>} */
  const byArch = { x64: [], arm64: [], universal: [], unknown: [] };
  for (const filePath of archives) {
    byArch[classifyMacArchiveArch(filePath)].push(filePath);
  }
  const hasArm64 = byArch.arm64.length > 0;
  const hasX64 = byArch.x64.length > 0 || (hasArm64 && byArch.unknown.length > 0);
  if (!hasArm64 || !hasX64) {
    fail(
      `Expected both x64 and arm64 macOS ${formatLabel} under release/; ` +
        `found arm64=${byArch.arm64.length}, x64=${byArch.x64.length}, ` +
        `unscoped=${byArch.unknown.length}, universal=${byArch.universal.length}`,
    );
  }
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

/**
 * @param {string} bundleRoot
 * @param {string} label
 * @param {{ dir: string, binary: string, minBytes: number }} framework
 */
function assertSiblingFrameworkSymlinks(bundleRoot, label, framework) {
  const frameworkRoot = path.join(bundleRoot, 'Contents', 'Frameworks', framework.dir);
  const currentLink = path.join(frameworkRoot, 'Versions', 'Current');
  const rootBinaryLink = path.join(frameworkRoot, framework.binary);
  const versionBinary = path.join(frameworkRoot, 'Versions', 'A', framework.binary);

  for (const linkPath of [currentLink, rootBinaryLink]) {
    if (!existsSync(linkPath)) {
      fail(`Missing ${label} ${framework.dir} entry: ${linkPath}`);
    }
    if (!lstatSync(linkPath).isSymbolicLink()) {
      fail(
        `${label} ${framework.dir} must be a symlink (ZIP tools like 7-Zip flatten these): ${linkPath}`,
      );
    }
  }

  assertMinSize(`${label} ${framework.dir} binary`, versionBinary, framework.minBytes);
}

/**
 * Drag-to-install affordance: DMG root must include Applications → /Applications.
 * Uses lstat (not existsSync) so the symlink is detected even if the target is absent
 * (e.g. unit tests on non-macOS hosts where /Applications does not exist).
 * @param {string} mountRoot
 */
function assertApplicationsSymlink(mountRoot) {
  const applicationsLink = path.join(mountRoot, 'Applications');
  let st;
  try {
    st = lstatSync(applicationsLink);
  } catch {
    fail(`Missing Applications symlink in dmg mount: ${applicationsLink}`);
  }
  if (!st.isSymbolicLink()) {
    fail(`Applications must be a symlink to /Applications: ${applicationsLink}`);
  }
  const target = readlinkSync(applicationsLink);
  if (target !== '/Applications') {
    fail(`Applications symlink must target /Applications (got ${JSON.stringify(target)})`);
  }
}

/** @param {string} mountRoot */
function assertDmgInstallNotice(mountRoot) {
  const noticePath = path.join(mountRoot, MACOS_DMG_NOTICE_NAME);
  if (!existsSync(noticePath) || !statSync(noticePath).isFile()) {
    fail(`Missing DMG install notice: ${noticePath}`);
  }
  const size = statSync(noticePath).size;
  if (size < 64) {
    fail(`DMG install notice too small (${size} bytes): ${noticePath}`);
  }
}

/** Electron 44+ requires Ventura; electron-builder.yml sets LSMinimumSystemVersion. */
const MIN_MACOS_SYSTEM_VERSION = '13.0.0';

/**
 * @param {string} version
 * @returns {number[]}
 */
function parseDottedVersion(version) {
  return String(version)
    .trim()
    .split('.')
    .map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @returns {number} negative if left < right, 0 if equal, positive if left > right
 */
function compareDottedVersions(left, right) {
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a - b;
  }
  return 0;
}

/**
 * @param {string} bundleRoot
 * @param {string} label
 */
function assertMacMinimumSystemVersion(bundleRoot, label) {
  const infoPlistPath = path.join(bundleRoot, 'Contents', 'Info.plist');
  if (!existsSync(infoPlistPath)) {
    fail(`Missing ${label} Info.plist: ${infoPlistPath}`);
  }
  const plist = readFileSync(infoPlistPath, 'utf8');
  const match = plist.match(
    /<key>\s*LSMinimumSystemVersion\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/i,
  );
  if (!match) {
    fail(
      `${label} Info.plist missing LSMinimumSystemVersion (expected >= ${MIN_MACOS_SYSTEM_VERSION})`,
    );
  }
  const found = match[1].trim();
  if (
    compareDottedVersions(parseDottedVersion(found), parseDottedVersion(MIN_MACOS_SYSTEM_VERSION)) <
    0
  ) {
    fail(
      `${label} LSMinimumSystemVersion is ${found}, need >= ${MIN_MACOS_SYSTEM_VERSION} (Electron 44 / Ventura)`,
    );
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
  for (const framework of SIBLING_FRAMEWORKS) {
    assertSiblingFrameworkSymlinks(bundleRoot, label, framework);
  }
  assertMinSize(`macOS launcher in ${label}`, launcherPath, MIN_LAUNCHER_BYTES);
  assertMinSize(`Electron Framework in ${label}`, frameworkPath, MIN_FRAMEWORK_BYTES);
  assertMacMinimumSystemVersion(bundleRoot, label);
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

/** @param {string} zipPath @param {string} extractDir @returns {string} */
function extractZipToTemp(zipPath, extractDir) {
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  // ditto -xk preserves symlinks inside electron-builder zips.
  runCommand('ditto', ['-xk', zipPath, extractDir], `Failed to extract zip with ditto: ${zipPath}`);

  const bundle = findCompleteAppBundle(extractDir);
  if (!bundle) {
    fail(`No complete ${APP_NAME}.app found inside zip: ${zipPath}`);
  }
  return bundle;
}

/** @param {string} dmgPath @param {string} mountDir @param {(bundleRoot: string) => void} validate */
function mountDmgAndValidate(dmgPath, mountDir, validate) {
  rmSync(mountDir, { recursive: true, force: true });
  mkdirSync(mountDir, { recursive: true });

  // hdiutil attach: mount dmg read-only for bundle inspection.
  runCommand(
    'hdiutil',
    ['attach', '-nobrowse', '-readonly', '-mountpoint', mountDir, dmgPath],
    `Failed to mount dmg with hdiutil: ${dmgPath}`,
  );

  try {
    assertApplicationsSymlink(mountDir);
    assertDmgInstallNotice(mountDir);
    const bundle = findCompleteAppBundle(mountDir);
    if (!bundle) {
      fail(`No complete ${APP_NAME}.app found inside dmg: ${dmgPath}`);
    }
    validate(bundle);
  } finally {
    detachDmgMount(mountDir);
  }
}

/** @param {string} mountDir */
function detachDmgMount(mountDir) {
  if (!existsSync(mountDir)) {
    return;
  }
  const quiet = spawnSync('hdiutil', ['detach', mountDir, '-quiet'], {
    stdio: 'inherit',
  });
  if (quiet.error || quiet.status !== 0) {
    console.warn(
      '[verify-mac-packaging] hdiutil detach failed, retrying with -force:',
      quiet.error,
    );
    const forced = spawnSync('hdiutil', ['detach', '-force', mountDir], {
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
  stageMacosInstallNoticeReleaseAsset(releaseDir);
  /** @type {string | null} */
  let zipExtractDir = null;
  /** @type {string | null} */
  let dmgMountDir = null;
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

    // Require both arches per format so a mixed set (e.g. arm64 DMG + x64 ZIP only) fails.
    assertDualArchMacArchives(dmgArchives, '.dmg');
    assertDualArchMacArchives(zipArchives, '.zip');

    for (const dmgPath of dmgArchives) {
      assertMinSize(`dmg ${path.basename(dmgPath)}`, dmgPath, MIN_DMG_BYTES);
    }
    for (const zipPath of zipArchives) {
      assertMinSize(`zip ${path.basename(zipPath)}`, zipPath, MIN_ZIP_BYTES);
    }

    zipExtractDir = mkdtempSync(path.join(tmpdir(), 'mesh-verify-mac-zip-'));
    dmgMountDir = mkdtempSync(path.join(tmpdir(), 'mesh-verify-mac-dmg-'));

    /** @type {string[]} */
    const validatedSources = [];

    /** @type {string[]} */
    const onDiskBundles = [];
    collectAppBundles(releaseDir, onDiskBundles);
    for (const bundle of onDiskBundles.filter((candidate) => isCompleteAppBundle(candidate))) {
      const parent = path.basename(path.dirname(bundle));
      validateAppBundle(bundle, `direct:${parent}`);
      validatedSources.push(`direct:${parent}/${path.basename(bundle)}`);
    }

    // Deep-validate every archive (both arches) — do not stop at the largest primary.
    for (const zipPath of zipArchives) {
      const zipLabel = `zip:${path.basename(zipPath)}`;
      const zipBundle = extractZipToTemp(zipPath, zipExtractDir);
      validateAppBundle(zipBundle, zipLabel);
      validatedSources.push(zipLabel);
    }

    for (const dmgPath of dmgArchives) {
      const dmgLabel = `dmg:${path.basename(dmgPath)}`;
      mountDmgAndValidate(dmgPath, dmgMountDir, (dmgBundle) => {
        validateAppBundle(dmgBundle, dmgLabel);
        validatedSources.push(dmgLabel);
      });
    }

    const version = readPackageVersion();
    console.debug(
      `[verify-mac-packaging] OK — validated via ${validatedSources.join(', ')}; ${dmgArchives.length} dmg, ${zipArchives.length} zip (v${version})`,
    );
  } finally {
    if (dmgMountDir) {
      detachDmgMount(dmgMountDir);
      rmSync(dmgMountDir, { recursive: true, force: true });
    }
    if (zipExtractDir) {
      rmSync(zipExtractDir, { recursive: true, force: true });
    }
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
  assertApplicationsSymlink,
  assertDmgInstallNotice,
  assertDualArchMacArchives,
  assertFrameworkSymlinks,
  assertMacMinimumSystemVersion,
  assertSiblingFrameworkSymlinks,
  classifyMacArchiveArch,
  collectAppBundles,
  collectArchives,
  detachDmgMount,
  fail,
  isCompleteAppBundle,
  pickPrimaryArchive,
  SIBLING_FRAMEWORKS,
  VerificationFailure,
};
