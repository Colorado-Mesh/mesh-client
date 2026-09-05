/**
 * Path helpers for per-arch Reticulum sidecar staging during electron-builder packaging.
 */
import path from 'path';

/** @typedef {'win32' | 'linux' | 'darwin'} ElectronPlatform */
/** @typedef {'x64' | 'arm64'} SidecarArchKey */

export const SIDECAR_BINARY_BASENAME = 'mesh-client-reticulum';
export const MIN_SIDECAR_BYTES = 1024 * 1024;

/** @type {Record<ElectronPlatform, { cargoTarget: string; archKey: SidecarArchKey }[]>} */
export const PLATFORM_TARGETS = {
  win32: [
    { cargoTarget: 'x86_64-pc-windows-msvc', archKey: 'x64' },
    { cargoTarget: 'aarch64-pc-windows-msvc', archKey: 'arm64' },
  ],
  linux: [
    { cargoTarget: 'x86_64-unknown-linux-gnu', archKey: 'x64' },
    { cargoTarget: 'aarch64-unknown-linux-gnu', archKey: 'arm64' },
  ],
  darwin: [
    { cargoTarget: 'x86_64-apple-darwin', archKey: 'x64' },
    { cargoTarget: 'aarch64-apple-darwin', archKey: 'arm64' },
  ],
};

/** @param {ElectronPlatform} platform */
export function sidecarBinaryFileName(platform) {
  return platform === 'win32' ? `${SIDECAR_BINARY_BASENAME}.exe` : SIDECAR_BINARY_BASENAME;
}

/**
 * Map electron-builder Arch enum to staging arch folder key.
 * @param {number} arch
 * @returns {SidecarArchKey}
 */
export function archKeyFromElectronBuilder(arch) {
  // builder-util Arch: ia32=0, x64=1, armv7l=2, arm64=3, universal=4
  if (arch === 1) return 'x64';
  if (arch === 3) return 'arm64';
  throw new Error(`Unsupported electron-builder arch: ${arch}`);
}

/**
 * @param {string} projectRoot
 * @param {ElectronPlatform} platform
 * @param {SidecarArchKey} archKey
 */
export function stagedSidecarDir(projectRoot, platform, archKey) {
  return path.join(
    projectRoot,
    'resources',
    'reticulum-sidecar',
    'staged',
    `${platform}-${archKey}`,
  );
}

/**
 * @param {string} projectRoot
 * @param {ElectronPlatform} platform
 * @param {SidecarArchKey} archKey
 */
export function stagedSidecarPath(projectRoot, platform, archKey) {
  return path.join(
    stagedSidecarDir(projectRoot, platform, archKey),
    sidecarBinaryFileName(platform),
  );
}

/**
 * @param {string} projectRoot
 * @param {ElectronPlatform} platform
 * @param {number} arch
 */
export function resolveStagedSidecarPathForPackContext(projectRoot, platform, arch) {
  const archKey = archKeyFromElectronBuilder(arch);
  return stagedSidecarPath(projectRoot, platform, archKey);
}

/**
 * Pack-time destination copied into extraResources before electron-builder packs.
 * @param {string} projectRoot
 * @param {ElectronPlatform} platform
 */
export function packSidecarResourcePath(projectRoot, platform) {
  return path.join(projectRoot, 'resources', 'reticulum-sidecar', sidecarBinaryFileName(platform));
}

/** @param {string} value */
export function parseElectronPlatform(value) {
  if (value === 'win32' || value === 'linux' || value === 'darwin') {
    return value;
  }
  throw new Error(`Unsupported --platform value: ${value}`);
}
