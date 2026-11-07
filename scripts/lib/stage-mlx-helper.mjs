import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * SwiftPM resource bundles that must sit next to `mesh-ai-mlx` so MLX can load
 * `default.metallib` (and related assets). Keep in sync with
 * `src/main/ai/os/mlxHelperInstall.ts` (`MLX_HELPER_SIDE_BUNDLES`).
 */
export const MLX_HELPER_SIDE_BUNDLES = [
  'mlx-swift_Cmlx.bundle',
  'swift-transformers_Hub.bundle',
  'swift-crypto_Crypto.bundle',
];

/**
 * Native/swiftbuild often links `mesh-ai-mlx` without compiling Cmlx Metal shaders into
 * `mlx-swift_Cmlx.bundle`. The Xcode build system emits that bundle (default.metallib).
 * Keep in sync with `src/main/ai/os/mlxHelperInstall.ts` (`MLX_SWIFT_BUILD_ARGS`).
 */
export const MLX_SWIFT_BUILD_ARGS = [
  'build',
  '-c',
  'release',
  '--product',
  'mesh-ai-mlx',
  '--build-system',
  'xcode',
];

/** True when the binary and the Cmlx metallib bundle are present. */
export function isMlxHelperInstallComplete(binaryPath) {
  if (!binaryPath || !existsSync(binaryPath)) return false;
  return existsSync(path.join(path.dirname(binaryPath), 'mlx-swift_Cmlx.bundle'));
}

/**
 * Locate a SwiftPM side bundle under a package `.build` tree (release / Products / triple).
 * @param {string} packageRoot
 * @param {string} bundleName
 * @returns {string | null}
 */
export function findMlxSideBundle(packageRoot, bundleName) {
  const buildRoot = path.join(packageRoot, '.build');
  /** @type {string[]} */
  const candidates = [
    path.join(buildRoot, 'release', bundleName),
    path.join(buildRoot, 'out', 'Products', 'Release', bundleName),
  ];
  if (existsSync(buildRoot)) {
    for (const entry of readdirSync(buildRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!entry.name.includes('apple-macos')) continue;
      candidates.push(path.join(buildRoot, entry.name, 'release', bundleName));
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Copy known side bundles from the SwiftPM build tree next to the release binary when
 * the linker left them elsewhere (or only under Products/).
 * @param {string} binaryPath
 * @param {string} packageRoot
 */
export function coLocateMlxSideBundles(binaryPath, packageRoot) {
  const destDir = path.dirname(binaryPath);
  for (const name of MLX_HELPER_SIDE_BUNDLES) {
    const dest = path.join(destDir, name);
    if (existsSync(dest)) continue;
    const found = findMlxSideBundle(packageRoot, name);
    if (!found) continue;
    rmSync(dest, { recursive: true, force: true });
    cpSync(found, dest, { recursive: true });
  }
}

/**
 * Copy `mesh-ai-mlx` and its adjacent SwiftPM bundles from a release/staged dir
 * into the destination install directory.
 *
 * @param {string} sourceBinary Absolute path to the built/staged binary.
 * @param {string} destBinary Absolute path for the install target binary.
 */
export function stageMlxHelperBinary(sourceBinary, destBinary) {
  const destDir = path.dirname(destBinary);
  mkdirSync(destDir, { recursive: true });
  cpSync(sourceBinary, destBinary);
  chmodSync(destBinary, 0o755);
  const sourceDir = path.dirname(sourceBinary);
  for (const name of MLX_HELPER_SIDE_BUNDLES) {
    const from = path.join(sourceDir, name);
    const to = path.join(destDir, name);
    if (!existsSync(from)) continue;
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
}
