/**
 * Shared assertions for packaged Reticulum sidecar binaries in Electron bundles.
 */
import { existsSync, statSync } from 'fs';

import { joinUnderRoot } from './lib/path-under-root.mjs';
import { assertBinaryArch } from './binary-arch.mjs';
import { MIN_SIDECAR_BYTES, sidecarBinaryFileName } from './reticulum-sidecar-staging.mjs';

/** @typedef {'win32' | 'linux' | 'darwin'} ElectronPlatform */

/**
 * Resolve bundled sidecar path inside a packaged Electron app root.
 * @param {ElectronPlatform} platform
 * @param {string} bundleRoot win/linux: unpacked dir containing `resources/`; mac: `.app` bundle root
 */
export function resolveBundledSidecarPath(platform, bundleRoot) {
  if (platform === 'darwin') {
    return joinUnderRoot(
      bundleRoot,
      'Contents',
      'Resources',
      'reticulum-sidecar',
      sidecarBinaryFileName(platform),
    );
  }
  return joinUnderRoot(
    bundleRoot,
    'resources',
    'reticulum-sidecar',
    sidecarBinaryFileName(platform),
  );
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} opts.sidecarPath
 * @param {(message: string) => void} opts.fail
 * @param {number} [opts.minBytes]
 * @param {ElectronPlatform} [opts.platform] Required when `expectedArch` is set.
 * @param {'x64' | 'arm64' | 'universal'} [opts.expectedArch]
 */
export function assertBundledReticulumSidecar({
  label,
  sidecarPath,
  fail,
  minBytes = MIN_SIDECAR_BYTES,
  platform,
  expectedArch,
}) {
  if (!existsSync(sidecarPath)) {
    fail(`Missing ${label}: ${sidecarPath}`);
  }
  const size = statSync(sidecarPath).size;
  if (size < minBytes) {
    fail(`${label} too small (${size} bytes, need >= ${minBytes}): ${sidecarPath}`);
  }
  if (expectedArch) {
    if (!platform) {
      fail(`${label} expectedArch requires platform`);
    }
    assertBinaryArch({
      label,
      filePath: sidecarPath,
      expectedArch,
      platform,
      fail,
    });
  }
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {ElectronPlatform} opts.platform
 * @param {string} opts.bundleRoot
 * @param {(message: string) => void} opts.fail
 * @param {'x64' | 'arm64' | 'universal'} [opts.expectedArch]
 */
export function assertBundledReticulumSidecarInBundle({
  label,
  platform,
  bundleRoot,
  fail,
  expectedArch,
}) {
  assertBundledReticulumSidecar({
    label,
    sidecarPath: resolveBundledSidecarPath(platform, bundleRoot),
    fail,
    platform,
    expectedArch,
  });
}
