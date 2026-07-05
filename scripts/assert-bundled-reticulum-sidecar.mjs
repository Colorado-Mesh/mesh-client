/**
 * Shared assertions for packaged Reticulum sidecar binaries in Electron bundles.
 */
import { existsSync, statSync } from 'fs';
import path from 'path';
import { MIN_SIDECAR_BYTES, sidecarBinaryFileName } from './reticulum-sidecar-staging.mjs';

/** @typedef {'win32' | 'linux' | 'darwin'} ElectronPlatform */

/**
 * Resolve bundled sidecar path inside a packaged Electron app root.
 * @param {ElectronPlatform} platform
 * @param {string} bundleRoot win/linux: unpacked dir containing `resources/`; mac: `.app` bundle root
 */
export function resolveBundledSidecarPath(platform, bundleRoot) {
  if (platform === 'darwin') {
    return path.join(
      bundleRoot,
      'Contents',
      'Resources',
      'reticulum-sidecar',
      sidecarBinaryFileName(platform),
    );
  }
  return path.join(bundleRoot, 'resources', 'reticulum-sidecar', sidecarBinaryFileName(platform));
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} opts.sidecarPath
 * @param {(message: string) => void} opts.fail
 * @param {number} [opts.minBytes]
 */
export function assertBundledReticulumSidecar({
  label,
  sidecarPath,
  fail,
  minBytes = MIN_SIDECAR_BYTES,
}) {
  if (!existsSync(sidecarPath)) {
    fail(`Missing ${label}: ${sidecarPath}`);
  }
  const size = statSync(sidecarPath).size;
  if (size < minBytes) {
    fail(`${label} too small (${size} bytes, need >= ${minBytes}): ${sidecarPath}`);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {ElectronPlatform} opts.platform
 * @param {string} opts.bundleRoot
 * @param {(message: string) => void} opts.fail
 */
export function assertBundledReticulumSidecarInBundle({ label, platform, bundleRoot, fail }) {
  assertBundledReticulumSidecar({
    label,
    sidecarPath: resolveBundledSidecarPath(platform, bundleRoot),
    fail,
  });
}
