#!/usr/bin/env node
/**
 * Post-dist:linux guard — fail CI if Linux packaging omits per-arch artifacts.
 *
 * Failure point: cross-arch electron-builder runs can silently skip an arch target.
 * Fallback: hard fail before artifact upload so a broken Linux build never ships.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const MIN_APP_IMAGE_BYTES = 50 * 1024 * 1024;
const MIN_DEB_RPM_BYTES = 1024 * 1024;

/** @param {string} msg */
function fail(msg) {
  console.error(`[verify-linux-packaging] ${msg}`);
  process.exit(1);
}

/** @param {string} name */
function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/** @param {string} name */
function isX64Name(name) {
  if (isArm64Name(name)) {
    return false;
  }
  return (
    name.endsWith('.AppImage') ||
    name.includes('_amd64') ||
    name.includes('.x86_64') ||
    name.includes('_x64')
  );
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

/** @param {string} filePath */
function assertElfAppImage(filePath) {
  const header = readFileSync(filePath).subarray(0, 4);
  if (header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    fail(`AppImage is not ELF: ${filePath}`);
  }
}

/** @param {string} arch @param {string[]} names @param {(name: string) => boolean} match */
function pickOne(arch, names, match) {
  const hits = names.filter(match);
  if (hits.length !== 1) {
    fail(
      `Expected exactly one ${arch} artifact, found ${hits.length}: ${hits.join(', ') || '(none)'}`,
    );
  }
  return hits[0];
}

function main() {
  if (!existsSync(releaseDir)) {
    fail(`Missing release directory: ${releaseDir}`);
  }

  const files = readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

  const appImages = files.filter((n) => n.endsWith('.AppImage'));
  const debs = files.filter((n) => n.endsWith('.deb'));
  const rpms = files.filter((n) => n.endsWith('.rpm'));

  const x64AppImage = pickOne('x64 AppImage', appImages, isX64Name);
  const arm64AppImage = pickOne('arm64 AppImage', appImages, isArm64Name);
  const x64Deb = pickOne('x64 deb', debs, isX64Name);
  const arm64Deb = pickOne('arm64 deb', debs, isArm64Name);
  const x64Rpm = pickOne('x64 rpm', rpms, isX64Name);
  const arm64Rpm = pickOne('arm64 rpm', rpms, isArm64Name);

  for (const name of [x64AppImage, arm64AppImage]) {
    const filePath = path.join(releaseDir, name);
    assertMinSize(name, filePath, MIN_APP_IMAGE_BYTES);
    assertElfAppImage(filePath);
  }

  for (const name of [x64Deb, arm64Deb, x64Rpm, arm64Rpm]) {
    assertMinSize(name, path.join(releaseDir, name), MIN_DEB_RPM_BYTES);
  }

  const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
  console.debug(
    `[verify-linux-packaging] OK — x64+arm64 AppImage/deb/rpm present (v${version}); AppImages: ${x64AppImage}, ${arm64AppImage}`,
  );
}

try {
  main();
} catch (e) {
  console.error('[verify-linux-packaging] Unexpected error:', e);
  process.exit(1);
}
