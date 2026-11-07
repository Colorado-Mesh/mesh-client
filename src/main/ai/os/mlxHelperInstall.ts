import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * SwiftPM resource bundles that must sit next to `mesh-ai-mlx` (default.metallib).
 * Keep in sync with `scripts/lib/stage-mlx-helper.mjs`.
 */
export const MLX_HELPER_SIDE_BUNDLES = [
  'mlx-swift_Cmlx.bundle',
  'swift-transformers_Hub.bundle',
  'swift-crypto_Crypto.bundle',
] as const;

/**
 * Prefer the Xcode build system so Cmlx Metal shaders land in `mlx-swift_Cmlx.bundle`.
 * Keep in sync with `scripts/lib/stage-mlx-helper.mjs`.
 */
export const MLX_SWIFT_BUILD_ARGS = [
  'build',
  '-c',
  'release',
  '--product',
  'mesh-ai-mlx',
  '--build-system',
  'xcode',
] as const;

/** True when the binary and the Cmlx metallib bundle are present. */
export function isMlxHelperInstallComplete(binaryPath: string): boolean {
  if (!binaryPath || !existsSync(binaryPath)) return false;
  return existsSync(path.join(path.dirname(binaryPath), 'mlx-swift_Cmlx.bundle'));
}

/** Locate a SwiftPM side bundle under a package `.build` tree. */
export function findMlxSideBundle(packageRoot: string, bundleName: string): string | null {
  const buildRoot = path.join(packageRoot, '.build');
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

/** Copy known side bundles from `.build` next to the release binary when needed. */
export function coLocateMlxSideBundles(binaryPath: string, packageRoot: string): void {
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
 * Copy `mesh-ai-mlx` and adjacent SwiftPM bundles into the install directory.
 * Without `mlx-swift_Cmlx.bundle`, generate fails with "Failed to load the default metallib".
 */
export function stageMlxHelperBinary(sourceBinary: string, destBinary: string): void {
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

export function resolveMlxBinaryPath(
  userBinary: string,
  bundledCandidates: string[],
): string | null {
  if (isMlxHelperInstallComplete(userBinary)) return userBinary;
  for (const candidate of bundledCandidates) {
    if (isMlxHelperInstallComplete(candidate)) return candidate;
  }
  return null;
}
