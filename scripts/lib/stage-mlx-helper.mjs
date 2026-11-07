import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
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
 * Default Swift build (swiftbuild). Do **not** use `--build-system xcode` —
 * Xcode SPM fails to resolve `MLXHuggingFaceMacros` on CI. Metallib packaging is
 * a separate post-step (`packageMlxCmlxMetallibBundle`).
 * Keep in sync with `src/main/ai/os/mlxHelperInstall.ts`.
 */
export const MLX_SWIFT_BUILD_ARGS = ['build', '-c', 'release', '--product', 'mesh-ai-mlx'];

/** Metal kernels shipped under mlx-swift `mlx-generated/metal` (see fix-metal-includes.sh). */
const MLX_CMLX_METAL_KERNELS = [
  'arg_reduce.metal',
  'conv.metal',
  'dot.metal',
  'layer_norm.metal',
  'random.metal',
  'rms_norm.metal',
  'rope.metal',
  'scaled_dot_product_attention.metal',
  'searchsorted.metal',
  'steel/attn/kernels/steel_attention.metal',
];

const CMLX_BUNDLE_INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleIdentifier</key>
\t<string>mlx-swift.Cmlx.resources</string>
\t<key>CFBundleName</key>
\t<string>mlx-swift_Cmlx</string>
\t<key>CFBundlePackageType</key>
\t<string>BNDL</string>
</dict>
</plist>
`;

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
 * @param {string} packageRoot
 * @returns {string | null}
 */
export function findMlxSwiftCheckout(packageRoot) {
  const checkouts = path.join(packageRoot, '.build', 'checkouts');
  if (!existsSync(checkouts)) return null;
  for (const entry of readdirSync(checkouts, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name !== 'mlx-swift' && !entry.name.startsWith('mlx-swift-')) continue;
    const metalRoot = path.join(checkouts, entry.name, 'Source', 'Cmlx', 'mlx-generated', 'metal');
    if (existsSync(metalRoot)) return path.join(checkouts, entry.name);
  }
  return null;
}

/**
 * Compile mlx-swift Cmlx Metal kernels into `mlx-swift_Cmlx.bundle` next to the binary.
 * Needed because default SwiftPM (swiftbuild) links without emitting that resource bundle.
 *
 * @param {string} binaryPath
 * @param {string} packageRoot
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
export function packageMlxCmlxMetallibBundle(binaryPath, packageRoot, opts = {}) {
  const destBundle = path.join(path.dirname(binaryPath), 'mlx-swift_Cmlx.bundle');
  if (existsSync(path.join(destBundle, 'Contents', 'Resources', 'default.metallib'))) return;

  const checkout = findMlxSwiftCheckout(packageRoot);
  if (!checkout) {
    throw new Error(
      `mlx-swift checkout with mlx-generated/metal not found under ${packageRoot}/.build/checkouts`,
    );
  }
  const metalRoot = path.join(checkout, 'Source', 'Cmlx', 'mlx-generated', 'metal');
  const env = opts.env ?? process.env;
  const work = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-metallib-'));
  try {
    /** @type {string[]} */
    const airFiles = [];
    for (const relative of MLX_CMLX_METAL_KERNELS) {
      const source = path.join(metalRoot, relative);
      if (!existsSync(source)) {
        throw new Error(`Missing Metal kernel ${relative} under ${metalRoot}`);
      }
      const airName = `${path.basename(relative, '.metal')}.air`;
      const airPath = path.join(work, airName);
      execFileSync(
        'xcrun',
        [
          '-sdk',
          'macosx',
          'metal',
          '-c',
          '-fno-fast-math',
          '-Wno-c++17-extensions',
          '-Wno-c++20-extensions',
          '-I',
          metalRoot,
          source,
          '-o',
          airPath,
        ],
        { env, stdio: 'pipe' },
      );
      airFiles.push(airPath);
    }
    const metallib = path.join(work, 'default.metallib');
    execFileSync('xcrun', ['-sdk', 'macosx', 'metallib', ...airFiles, '-o', metallib], {
      env,
      stdio: 'pipe',
    });
    const resources = path.join(destBundle, 'Contents', 'Resources');
    rmSync(destBundle, { recursive: true, force: true });
    mkdirSync(resources, { recursive: true });
    writeFileSync(path.join(destBundle, 'Contents', 'Info.plist'), CMLX_BUNDLE_INFO_PLIST);
    cpSync(metallib, path.join(resources, 'default.metallib'));
  } finally {
    rmSync(work, { recursive: true, force: true });
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
