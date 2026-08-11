#!/usr/bin/env node
/**
 * Post-dist:linux:headless guard — fail CI if the slim headless tar.gz artifacts
 * are missing or malformed.
 *
 * Failure point: cross-arch electron-builder runs can silently skip an arch
 * target, or the headless build could regress into shipping desktop-only weight.
 * Fallback: hard fail before artifact upload so a broken headless image never ships.
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { assertBundledReticulumSidecarInBundle } from './assert-bundled-reticulum-sidecar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const headlessDir = path.join(projectRoot, 'release-headless');

const MIN_TAR_GZ_BYTES = 50 * 1024 * 1024;

/** @param {string} msg */
export function fail(msg) {
  console.error(`[verify-headless-linux-packaging] ${msg}`);
  process.exit(1);
}

/** @param {string} name */
export function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/** @param {string} name */
export function isX64Name(name) {
  return !isArm64Name(name) && name.endsWith('.tar.gz');
}

/**
 * @param {string} label @param {string} filePath @param {number} minBytes
 */
function assertMinSize(label, filePath, minBytes) {
  if (!existsSync(filePath)) {
    fail(`Missing ${label}: ${filePath}`);
  }
  const size = statSync(filePath).size;
  if (size < minBytes) {
    fail(`${label} too small (${size} bytes, need >= ${minBytes}): ${filePath}`);
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
  if (!existsSync(headlessDir)) {
    fail(`Missing headless output directory: ${headlessDir}`);
  }

  const files = readdirSync(headlessDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  const archives = files.filter((n) => n.endsWith('.tar.gz'));
  const x64Archive = pickOne('x64 tar.gz', archives, isX64Name);
  const arm64Archive = pickOne('arm64 tar.gz', archives, isArm64Name);

  for (const name of [x64Archive, arm64Archive]) {
    assertMinSize(name, path.join(headlessDir, name), MIN_TAR_GZ_BYTES);
  }

  for (const [label, dirName] of [
    ['x64', 'linux-unpacked'],
    ['arm64', 'linux-arm64-unpacked'],
  ]) {
    const bundleRoot = path.join(headlessDir, dirName);
    if (!existsSync(bundleRoot)) {
      continue;
    }
    assertBundledReticulumSidecarInBundle({
      label: `${label} bundled Reticulum sidecar`,
      platform: 'linux',
      bundleRoot,
      fail,
    });
  }

  console.debug(
    `[verify-headless-linux-packaging] OK — x64+arm64 tar.gz present: ${x64Archive}, ${arm64Archive}`,
  );
}

function isMain() {
  return (
    process.argv[1] &&
    path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
  );
}

if (isMain()) {
  try {
    main();
  } catch (e) {
    console.error('[verify-headless-linux-packaging] Unexpected error:', e);
    process.exit(1);
  }
}
