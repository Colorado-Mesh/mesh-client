#!/usr/bin/env node
/**
 * CI smoke: extract Linux AppImages and assert the Reticulum sidecar is bundled.
 *
 * Works when packaging-smoke artifacts include AppImages but not linux-unpacked dirs.
 */
import { spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';
import { assertBundledReticulumSidecarInBundle } from './assert-bundled-reticulum-sidecar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

/** @param {string} msg */
function fail(msg) {
  console.error(`[test-linux-appimage-reticulum-sidecar] ${msg}`);
  process.exit(1);
}

/** @param {string} name */
function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/** Prepare a clean extract directory for AppImage --appimage-extract (spawnSync needs existing cwd). */
export function prepareAppImageExtractDir(extractDir) {
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
}

/** @param {string} appImagePath @param {string} extractDir */
function extractAppImage(appImagePath, extractDir) {
  prepareAppImageExtractDir(extractDir);
  // Artifact downloads may drop +x on AppImages.
  chmodSync(appImagePath, 0o755);
  const result = spawnSync(appImagePath, ['--appimage-extract'], {
    cwd: extractDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    fail(`Failed to run AppImage extract: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(`AppImage extract exited ${result.status ?? 'null'} for ${appImagePath}`);
  }
  const payloadRoot = path.join(extractDir, 'squashfs-root');
  if (!existsSync(payloadRoot)) {
    fail(`AppImage extract did not create squashfs-root under ${extractDir}`);
  }
  return payloadRoot;
}

/** @param {'x64' | 'arm64'} arch @param {string} appImagePath */
function assertSidecarInAppImage(arch, appImagePath) {
  const extractDir = path.join(tmpdir(), `mesh-client-appimage-${arch}-${process.pid}`);
  const payloadRoot = extractAppImage(appImagePath, extractDir);
  assertBundledReticulumSidecarInBundle({
    label: `${arch} AppImage Reticulum sidecar`,
    platform: 'linux',
    bundleRoot: payloadRoot,
    fail,
  });
  rmSync(extractDir, { recursive: true, force: true });
  console.debug(
    `[test-linux-appimage-reticulum-sidecar] OK — sidecar present in ${path.basename(appImagePath)}`,
  );
}

function main() {
  if (process.platform !== 'linux') {
    console.debug('[test-linux-appimage-reticulum-sidecar] Skipping on non-Linux host');
    return;
  }

  if (!existsSync(releaseDir)) {
    fail(`Missing release directory: ${releaseDir}`);
  }

  const appImages = readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.AppImage'))
    .map((e) => e.name);

  const x64Images = appImages.filter((n) => !isArm64Name(n));
  const arm64Images = appImages.filter((n) => isArm64Name(n));

  if (x64Images.length !== 1) {
    fail(
      `Expected exactly one x64 AppImage, found ${x64Images.length}: ${x64Images.join(', ') || '(none)'}`,
    );
  }
  if (arm64Images.length !== 1) {
    fail(
      `Expected exactly one arm64 AppImage, found ${arm64Images.length}: ${arm64Images.join(', ') || '(none)'}`,
    );
  }

  for (const [arch, name] of [
    ['x64', x64Images[0]],
    ['arm64', arm64Images[0]],
  ]) {
    const appImagePath = path.join(releaseDir, name);
    const size = statSync(appImagePath).size;
    if (size < 50 * 1024 * 1024) {
      fail(`AppImage too small (${size} bytes): ${appImagePath}`);
    }
    assertSidecarInAppImage(arch, appImagePath);
  }

  const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
  console.debug(
    `[test-linux-appimage-reticulum-sidecar] OK — x64+arm64 AppImages bundle Reticulum sidecar (v${version})`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    main();
  } catch (e) {
    console.error('[test-linux-appimage-reticulum-sidecar] Unexpected error:', e);
    process.exit(1);
  }
}
