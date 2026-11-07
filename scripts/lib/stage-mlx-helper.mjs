import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * SwiftPM resource bundles that must sit next to `mesh-ai-mlx` so MLX can load
 * `default.metallib` (and related assets). Keep in sync with
 * `src/main/ai/os/ensureMlxHelper.ts` (`MLX_HELPER_SIDE_BUNDLES`).
 */
export const MLX_HELPER_SIDE_BUNDLES = [
  'mlx-swift_Cmlx.bundle',
  'swift-transformers_Hub.bundle',
  'swift-crypto_Crypto.bundle',
];

/** True when the binary and the Cmlx metallib bundle are present. */
export function isMlxHelperInstallComplete(binaryPath) {
  if (!binaryPath || !existsSync(binaryPath)) return false;
  return existsSync(path.join(path.dirname(binaryPath), 'mlx-swift_Cmlx.bundle'));
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
