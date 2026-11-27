#!/usr/bin/env node
/**
 * Build the Reticulum sidecar for the mobile apps.
 *
 *   node mobile/scripts/build-sidecar.mjs android [--abi arm64-v8a,x86_64] [--debug] [--skip-clone]
 *   node mobile/scripts/build-sidecar.mjs ios [--debug] [--skip-clone]          (macOS + Xcode)
 *   node mobile/scripts/build-sidecar.mjs ios --check [--target <triple>,...]   (cargo check, any host)
 *   node mobile/scripts/build-sidecar.mjs stage [--skip-clone]                  (stage crate only)
 *   Common: [--features <cargo features>] (default MOBILE_SIDECAR_FEATURES)
 *
 * Stage crate: the desktop crate (reticulum-sidecar/) is never modified. Every run first writes a
 * copy of it to mobile/native/.stage/reticulum-sidecar/ (gitignored, see stageSidecarCrate) with
 * three build-time changes to its Cargo.toml (mobileSidecarManifest):
 *   - every relative `path = "../..."` dependency points at its real, absolute location;
 *   - a `[lib]` target, `mesh_client_reticulum`, whose src/lib.rs is
 *     mobile/native/reticulum-lib/lib.rs (the desktop main.rs with injected stdio, for iOS);
 *   - the rns-runtime `serial` feature (serialport) is desktop-only: the apps own USB serial in
 *     native plugins, and serialport links IOKit on iOS.
 * Files the crate reads outside src/ (vendor/ and SIDECAR_SHARED_INPUTS) are copied beside it in
 * the same relative layout. Unchanged files are not rewritten, so cargo's fingerprints hold. Cargo
 * output goes to reticulum-sidecar/target (gitignored, shared with desktop builds, as before).
 *
 * Android: the unmodified desktop `mesh-client-reticulum` executable (the stage copy of
 * src/main.rs), cross-compiled with the NDK (API 24) and staged as
 * mobile/android/app/src/main/jniLibs/<abi>/libmesh_client_reticulum.so. The MeshProcess plugin
 * execs it from nativeLibraryDir (legacy extracted packaging). The NDK comes from
 * ANDROID_NDK_HOME / ANDROID_NDK_ROOT / NDK_HOME, else the newest <sdk>/ndk/<version> under
 * ANDROID_HOME / ANDROID_SDK_ROOT / the default SDK location. Linkers are passed per invocation
 * through env, so nothing machine-specific is written to the repo.
 *
 * iOS: apps cannot spawn processes, so mobile/native/reticulum-ffi (C ABI,
 * include/mesh_reticulum.h) links the stage crate's library and is built as a static library for
 * device + simulator, packaged as mobile/ios/App/MeshReticulum.xcframework for the Swift
 * MeshProcess plugin.
 *
 * FFI host tests (drive the C ABI through real pipes; run from the repository root):
 *   node mobile/scripts/build-sidecar.mjs stage
 *   cargo test --manifest-path mobile/native/reticulum-ffi/Cargo.toml
 *     --target-dir reticulum-sidecar/target [--features rns-stack,rns-rnode-tcp]
 * (`stage` also seeds the FFI crate's gitignored Cargo.lock from reticulum-sidecar/Cargo.lock.)
 *
 * Mobile feature set: the full stack without BLE (rns-ble / gatt-ble: btleplug) and without USB
 * serial (see above): the apps own BLE and USB in native plugins.
 *
 * Failure point: staging (an anchor in the desktop Cargo.toml moved, an unlisted input) or any
 * cargo / NDK / Xcode step exits non-zero. Fallback: none; staging computes every file before
 * writing any, and outputs are only replaced after a successful build, so a failed run leaves the
 * previous staged binary.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isPathInsideRoot, joinUnderRoot } from '../../scripts/lib/path-under-root.mjs';
import { MIN_SIDECAR_BYTES } from '../../scripts/reticulum-sidecar-staging.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (this file lives in mobile/scripts/). */
const projectRoot = path.resolve(__dirname, '..', '..');
const LOG_PREFIX = '[build-sidecar]';

export const MOBILE_SIDECAR_FEATURES = 'rns-stack,rns-rnode-tcp';
const ANDROID_MIN_API = 24;
const ANDROID_LIB_NAME = 'libmesh_client_reticulum.so';
const IOS_DEPLOYMENT_TARGET = '15.0';
const IOS_XCFRAMEWORK = 'mobile/ios/App/MeshReticulum.xcframework';
const IOS_STATICLIB = 'libmesh_reticulum.a';

/** @type {Record<string, string>} Android ABI to Rust target triple. */
export const ANDROID_ABIS = {
  'arm64-v8a': 'aarch64-linux-android',
  x86_64: 'x86_64-linux-android',
};

export const IOS_DEVICE_TARGET = 'aarch64-apple-ios';
const IOS_SIMULATOR_TARGETS = ['aarch64-apple-ios-sim', 'x86_64-apple-ios'];

/** @param {string} msg @returns {never} */
function fail(msg) {
  console.error(LOG_PREFIX, msg);
  process.exit(1);
}

// --- Stage crate -------------------------------------------------------------------------

/** Name of the staged crate directory under the stage root (mirrors the repo layout). */
const STAGE_CRATE = 'reticulum-sidecar';

/**
 * Relative `path = "../..."` dependencies in reticulum-sidecar/Cargo.toml (all under ../.rsstack).
 * A different count means the desktop manifest changed shape: review the stage, then update this.
 */
export const SIDECAR_RELATIVE_DEP_PATHS = 13;

/**
 * Files outside the crate that its sources read with include_str! (repo-relative). They are copied
 * to the same place relative to the stage crate. Staging fails when a source reads an unlisted one.
 */
export const SIDECAR_SHARED_INPUTS = [
  'src/shared/fixtures/localConnectHostClassification.json',
  'src/shared/reticulumInterfaceCatalog.json',
  'src/shared/reticulumRnodeRfProfiles.json',
];

/** Crate-root files copied when present (Cargo.lock is required). */
const STAGE_CRATE_FILES = ['Cargo.lock', 'rust-toolchain.toml', 'build.rs'];

const STAGE_MANIFEST_HEADER = `# Generated by mobile/scripts/build-sidecar.mjs from reticulum-sidecar/Cargo.toml; every mobile
# build rewrites it. Change the desktop manifest or the staging script, never this file.

`;

const LIB_SECTION = `# Mobile library root (mobile/native/reticulum-lib/lib.rs: the desktop main.rs with injected
# stdio), embedded in-process on iOS by mobile/native/reticulum-ffi. The crate name matches the
# binary so tracing targets stay mesh_client_reticulum::*. Doctests off: the module tree never ran
# any as a binary crate.
[lib]
name = "mesh_client_reticulum"
path = "src/lib.rs"
doctest = false
`;

const SERIAL_DEPENDENCY = [
  '[dependencies.rns-runtime]',
  'package = "rns-runtime"',
  'path = "../.rsstack/rsReticulum/crates/rns-runtime"',
  'optional = true',
  'features = ["serial"]',
  '',
].join('\n');

const SERIAL_DESKTOP_ONLY = [
  '[dependencies.rns-runtime]',
  'package = "rns-runtime"',
  'path = "../.rsstack/rsReticulum/crates/rns-runtime"',
  'optional = true',
  '',
  '# USB serial (serialport) on desktop only. Mobile apps own USB serial in their native plugins,',
  '# and serialport links IOKit on iOS. Same dependency as above; Cargo unions the features.',
  `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies.rns-runtime]`,
  'package = "rns-runtime"',
  'path = "../.rsstack/rsReticulum/crates/rns-runtime"',
  'optional = true',
  'features = ["serial"]',
  '',
].join('\n');

const RELATIVE_DEP_PATH = /(\bpath\s*=\s*")(\.\.\/[^"]*)(")/g;
const MANIFEST_PATH_VALUE = /\bpath\s*=\s*"([^"]*)"/g;
const SHARED_INPUT_REFERENCE = /\bsrc\/shared\/[^"\s]+(?=")/g;

/**
 * Paths for one checkout; everything derives from the repository root.
 * @param {string} [repoRoot]
 */
export function sidecarLayout(repoRoot = projectRoot) {
  const sidecarDir = joinUnderRoot(repoRoot, 'reticulum-sidecar');
  const nativeDir = joinUnderRoot(repoRoot, 'mobile', 'native');
  const stageRoot = joinUnderRoot(nativeDir, '.stage');
  return {
    repoRoot,
    sidecarDir,
    targetDir: joinUnderRoot(sidecarDir, 'target'),
    libSource: joinUnderRoot(nativeDir, 'reticulum-lib', 'lib.rs'),
    ffiDir: joinUnderRoot(nativeDir, 'reticulum-ffi'),
    stageRoot,
  };
}

/** @param {string} text @param {string} needle */
function countOccurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    count++;
  }
  return count;
}

/**
 * Replace the only occurrence of `anchor`; throw when it is missing or repeated.
 * @param {string} text @param {string} anchor @param {string} replacement @param {string} what
 */
function replaceOnce(text, anchor, replacement, what) {
  const count = countOccurrences(text, anchor);
  if (count !== 1) {
    throw new Error(
      `reticulum-sidecar/Cargo.toml: expected exactly 1 ${what}, found ${count}; update the mobile stage in mobile/scripts/build-sidecar.mjs`,
    );
  }
  return text.replace(anchor, () => replacement);
}

/**
 * The stage crate's Cargo.toml: the desktop manifest with absolute dependency paths, a `[lib]`
 * target and the rns-runtime `serial` feature made desktop-only. Throws when an anchor is missing.
 * @param {string} source desktop reticulum-sidecar/Cargo.toml
 * @param {{ sidecarDir: string; repoRoot: string }} layout
 * @returns {string}
 */
export function mobileSidecarManifest(source, { sidecarDir, repoRoot }) {
  let text = source.replace(/\r\n/g, '\n');
  const relative = [...text.matchAll(RELATIVE_DEP_PATH)].length;
  if (relative !== SIDECAR_RELATIVE_DEP_PATHS) {
    throw new Error(
      `reticulum-sidecar/Cargo.toml has ${relative} relative path = "../..." dependencies, expected ${SIDECAR_RELATIVE_DEP_PATHS}; review the mobile stage, then update SIDECAR_RELATIVE_DEP_PATHS`,
    );
  }
  if (/^\s*\[lib\]\s*$/m.test(text)) {
    throw new Error(
      'reticulum-sidecar/Cargo.toml already has a [lib] section; the mobile [lib] would conflict',
    );
  }
  text = replaceOnce(text, '\n[[bin]]\n', `\n${LIB_SECTION}\n[[bin]]\n`, '[[bin]] section');
  text = replaceOnce(
    text,
    SERIAL_DEPENDENCY,
    SERIAL_DESKTOP_ONLY,
    'rns-runtime dependency table ending in features = ["serial"]',
  );
  let rewritten = 0;
  text = text.replace(RELATIVE_DEP_PATH, (_match, open, relativePath, close) => {
    rewritten++;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- manifest value, checked inside the repo below.
    const absolute = path.resolve(sidecarDir, relativePath);
    if (!isPathInsideRoot(repoRoot, absolute)) {
      throw new Error(`reticulum-sidecar/Cargo.toml path ${relativePath} leaves the repository`);
    }
    const tomlPath = absolute.split(path.sep).join('/');
    if (/["\\]/.test(tomlPath)) throw new Error(`cannot write ${tomlPath} as a TOML string`);
    return `${open}${tomlPath}${close}`;
  });
  // The desktop-only serial table repeats the rns-runtime path once.
  if (rewritten !== SIDECAR_RELATIVE_DEP_PATHS + 1 || text.includes('"../')) {
    throw new Error(`stage Cargo.toml: rewrote ${rewritten} relative paths, expected all of them`);
  }
  return `${STAGE_MANIFEST_HEADER}${text}`;
}

/**
 * Every regular file under `dir` as [posix path relative to `dir`, absolute path].
 * @param {string} dir @param {string} [prefix] @param {(rel: string) => boolean} [skipDir]
 * @returns {Array<[string, string]>}
 */
function listFiles(dir, prefix = '', skipDir = () => false) {
  if (!existsSync(dir)) return [];
  /** @type {Array<[string, string]>} */
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = joinUnderRoot(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDir(rel)) files.push(...listFiles(abs, rel, skipDir));
    } else if (entry.isFile()) {
      files.push([rel, abs]);
    }
  }
  return files;
}

/** @param {string} root @param {string} posixRel */
function underRoot(root, posixRel) {
  return joinUnderRoot(root, ...posixRel.split('/'));
}

/**
 * Write the mobile stage crate (see the file header). Computes every file first and throws before
 * writing anything when the desktop crate no longer matches; then writes only files whose bytes
 * changed and removes stale ones, so a second run with no upstream change touches nothing.
 * @param {{ repoRoot?: string; stageRoot?: string; libSource?: string }} [roots]
 * @returns {{ crateDir: string; manifestPath: string; dependencyPaths: string[];
 *   written: string[]; removed: string[] }} paths in `written` / `removed` are stage-relative
 */
export function stageSidecarCrate(roots = {}) {
  const layout = sidecarLayout(roots.repoRoot);
  const stageRoot = roots.stageRoot ?? layout.stageRoot;
  const libSource = roots.libSource ?? layout.libSource;
  const { repoRoot, sidecarDir } = layout;

  const manifestSource = joinUnderRoot(sidecarDir, 'Cargo.toml');
  if (!existsSync(manifestSource)) throw new Error(`missing ${manifestSource}`);
  const manifest = mobileSidecarManifest(readFileSync(manifestSource, 'utf8'), layout);

  /** @type {Map<string, Buffer>} stage-relative posix path to contents */
  const desired = new Map([[`${STAGE_CRATE}/Cargo.toml`, Buffer.from(manifest, 'utf8')]]);
  for (const name of STAGE_CRATE_FILES) {
    const file = joinUnderRoot(sidecarDir, name);
    if (existsSync(file)) desired.set(`${STAGE_CRATE}/${name}`, readFileSync(file));
    else if (name === 'Cargo.lock') throw new Error(`missing ${file}`);
  }
  for (const [rel, abs] of listFiles(joinUnderRoot(sidecarDir, 'src'))) {
    if (rel === 'lib.rs') {
      throw new Error(
        'reticulum-sidecar/src/lib.rs exists upstream; the mobile stage writes its own src/lib.rs',
      );
    }
    desired.set(`${STAGE_CRATE}/src/${rel}`, readFileSync(abs));
  }
  if (!existsSync(libSource)) throw new Error(`missing mobile library root ${libSource}`);
  desired.set(`${STAGE_CRATE}/src/lib.rs`, readFileSync(libSource));
  for (const [rel, abs] of listFiles(joinUnderRoot(sidecarDir, 'vendor'))) {
    desired.set(`${STAGE_CRATE}/vendor/${rel}`, readFileSync(abs));
  }

  const listed = new Set(SIDECAR_SHARED_INPUTS);
  for (const [rel, contents] of desired) {
    if (!rel.endsWith('.rs')) continue;
    for (const [reference] of contents.toString('utf8').matchAll(SHARED_INPUT_REFERENCE)) {
      if (!listed.has(reference)) {
        throw new Error(
          `${rel} reads ${reference}, which the mobile stage does not copy; add it to SIDECAR_SHARED_INPUTS`,
        );
      }
    }
  }
  for (const rel of SIDECAR_SHARED_INPUTS) {
    const file = underRoot(repoRoot, rel);
    if (!existsSync(file)) throw new Error(`missing sidecar input ${file}`);
    desired.set(rel, readFileSync(file));
  }

  const removed = [];
  const skipCargoOutput = (/** @type {string} */ rel) => rel === `${STAGE_CRATE}/target`;
  for (const [rel, abs] of listFiles(stageRoot, '', skipCargoOutput)) {
    if (desired.has(rel)) continue;
    rmSync(abs, { force: true });
    removed.push(rel);
  }
  const written = [];
  for (const [rel, contents] of desired) {
    const file = underRoot(stageRoot, rel);
    if (existsSync(file) && readFileSync(file).equals(contents)) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    written.push(rel);
  }

  const crateDir = joinUnderRoot(stageRoot, STAGE_CRATE);
  const dependencyPaths = [...manifest.matchAll(MANIFEST_PATH_VALUE)]
    .map(([, value]) => value)
    .filter((value) => path.isAbsolute(value));
  return {
    crateDir,
    manifestPath: joinUnderRoot(crateDir, 'Cargo.toml'),
    dependencyPaths,
    written,
    removed,
  };
}

/** Stage for a build, turning a staging error into a build failure. */
function stageForBuild() {
  let stage;
  try {
    stage = stageSidecarCrate();
  } catch (e) {
    return fail(`staging failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const missing = stage.dependencyPaths.filter((dir) => !existsSync(dir));
  if (missing.length) {
    fail(
      `missing sidecar dependencies (run without --skip-clone to provision .rsstack): ${missing.join(', ')}`,
    );
  }
  console.debug(
    LOG_PREFIX,
    `staged ${stage.crateDir} (${stage.written.length} written, ${stage.removed.length} removed)`,
  );
  return stage;
}

// --- Commands ----------------------------------------------------------------------------

/** Toolchain basenames allowed without an absolute path (avoid PATH hijack). */
const SPAWN_CMD_ALLOWLIST = new Set(['cargo', 'rustup']);

/** @param {string} cmd */
function assertSpawnExecutable(cmd) {
  if (path.isAbsolute(cmd) || SPAWN_CMD_ALLOWLIST.has(cmd)) return cmd;
  return fail(`refusing to spawn non-absolute command: ${cmd}`);
}

/**
 * Run a command with inherited stdio; stderr is also captured when `captureStderr` is set.
 * @param {string} cmd @param {string[]} args
 * @param {{ cwd: string; env?: NodeJS.ProcessEnv; captureStderr?: boolean }} opts
 * @returns {Promise<string>} captured stderr ('' unless requested)
 */
function run(cmd, args, { cwd, env = {}, captureStderr = false }) {
  const executable = assertSpawnExecutable(cmd);
  console.debug(LOG_PREFIX, cmd, args.join(' '));
  return new Promise((resolve) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- cmd validated by assertSpawnExecutable (absolute or toolchain allowlist), argv only.
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['inherit', 'inherit', captureStderr ? 'pipe' : 'inherit'],
      shell: false,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      process.stderr.write(chunk);
      stderr += chunk.toString('utf8');
    });
    child.on('error', (e) => fail(`Failed to run ${cmd}: ${e.message}`));
    child.on('close', (code) => {
      if (code !== 0) fail(`${cmd} ${args.join(' ')} exited ${code ?? 'null'}`);
      resolve(stderr);
    });
  });
}

function cloneRatspeakStack() {
  const scriptPath = joinUnderRoot(projectRoot, 'scripts', 'clone-ratspeak-stack.sh');
  const result = spawnSync('/bin/bash', [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT ?? joinUnderRoot(projectRoot, '.rsstack'),
    },
  });
  if (result.error) fail(`Failed to run clone-ratspeak-stack.sh: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) fail(`clone-ratspeak-stack.sh exited ${result.status ?? 'null'}`);
}

/**
 * Fail early with the rustup command when a target's standard library is missing.
 * @param {string[]} triples @param {string} cwd stage crate (its rust-toolchain.toml applies)
 */
function assertRustTargets(triples, cwd) {
  const result = spawnSync('rustup', ['target', 'list', '--installed'], { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) return; // no rustup: let cargo report it
  const installed = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()));
  const missing = triples.filter((triple) => !installed.has(triple));
  if (missing.length) fail(`missing Rust targets; run: rustup target add ${missing.join(' ')}`);
}

/**
 * @param {string[]} argv
 * @returns {{ platform: 'android' | 'ios' | 'stage'; abis: string[]; iosTargets: string[];
 *   check: boolean; debug: boolean; skipClone: boolean; features: string }}
 */
export function parseMobileArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      abi: { type: 'string', multiple: true },
      target: { type: 'string', multiple: true },
      check: { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      'skip-clone': { type: 'boolean', default: false },
      features: { type: 'string' },
    },
  });
  const [platform, ...extra] = positionals;
  if ((platform !== 'android' && platform !== 'ios' && platform !== 'stage') || extra.length) {
    throw new Error(
      'Usage: build-sidecar.mjs android [--abi arm64-v8a,x86_64] | ios [--check [--target <triple>]] | stage [--debug] [--skip-clone] [--features <list>]',
    );
  }
  const split = (/** @type {string[] | undefined} */ list) =>
    (list ?? []).flatMap((value) => value.split(',')).map((value) => value.trim());
  const abis = split(values.abi);
  if (platform !== 'android' && abis.length) throw new Error('--abi applies to android only');
  for (const abi of abis) {
    if (!Object.hasOwn(ANDROID_ABIS, abi)) throw new Error(`Unsupported --abi: ${abi}`);
  }
  if (values.check && platform !== 'ios') throw new Error('--check applies to ios only');
  const targets = split(values.target);
  if (targets.length && !values.check) throw new Error('--target applies to ios --check only');
  const iosTargetSet = new Set([IOS_DEVICE_TARGET, ...IOS_SIMULATOR_TARGETS]);
  for (const target of targets) {
    if (!iosTargetSet.has(target)) throw new Error(`Unsupported --target: ${target}`);
  }
  return {
    platform,
    abis: abis.length ? abis : Object.keys(ANDROID_ABIS),
    iosTargets: targets.length ? targets : [IOS_DEVICE_TARGET],
    check: values.check,
    debug: values.debug,
    skipClone: values['skip-clone'],
    features: values.features ?? MOBILE_SIDECAR_FEATURES,
  };
}

// --- Android -----------------------------------------------------------------------------

/** @param {string} version */
function versionKey(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/**
 * Locate the Android NDK root.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ home?: string; platform?: NodeJS.Platform; exists?: (p: string) => boolean;
 *   listDir?: (p: string) => string[] }} [deps]
 * @returns {string | null}
 */
export function resolveAndroidNdk(env, deps = {}) {
  const {
    home = os.homedir(),
    platform = process.platform,
    exists = existsSync,
    listDir = (dir) => readdirSync(dir),
  } = deps;
  for (const key of ['ANDROID_NDK_HOME', 'ANDROID_NDK_ROOT', 'NDK_HOME']) {
    const value = env[key]?.trim();
    if (value) return exists(value) ? value : null;
  }
  const defaultSdk =
    platform === 'darwin'
      ? path.join(home, 'Library', 'Android', 'sdk')
      : platform === 'win32'
        ? path.join(env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'Android', 'Sdk')
        : path.join(home, 'Android', 'Sdk');
  const sdk = env.ANDROID_HOME?.trim() || env.ANDROID_SDK_ROOT?.trim() || defaultSdk;
  const ndkParent = path.join(sdk, 'ndk');
  if (!exists(ndkParent)) return null;
  const versions = listDir(ndkParent)
    .filter((name) => name.split('.').every((part) => /^\d+$/.test(part)))
    .sort((a, b) => {
      const [ka, kb] = [versionKey(a), versionKey(b)];
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        const diff = (ka[i] ?? 0) - (kb[i] ?? 0);
        if (diff) return diff;
      }
      return 0;
    });
  const newest = versions.at(-1);
  return newest ? path.join(ndkParent, newest) : null;
}

/** NDK prebuilt host directory (`darwin-x86_64` is universal on Apple silicon). */
export function ndkHostTag(platform = process.platform) {
  if (platform === 'linux') return 'linux-x86_64';
  if (platform === 'darwin') return 'darwin-x86_64';
  if (platform === 'win32') return 'windows-x86_64';
  throw new Error(`No Android NDK host toolchain for ${platform}`);
}

/** @param {string} ndkRoot @param {NodeJS.Platform} [platform] */
function ndkToolBin(ndkRoot, platform = process.platform) {
  return path.join(ndkRoot, 'toolchains', 'llvm', 'prebuilt', ndkHostTag(platform), 'bin');
}

/**
 * Per-invocation cargo/cc env for one Android triple (linker + C toolchain for bundled SQLite).
 * @param {string} ndkRoot @param {string} triple
 * @param {{ api?: number; platform?: NodeJS.Platform }} [opts]
 * @returns {Record<string, string>}
 */
export function androidCargoEnv(ndkRoot, triple, { api = ANDROID_MIN_API, platform } = {}) {
  const bin = ndkToolBin(ndkRoot, platform);
  const ext = (platform ?? process.platform) === 'win32' ? '.cmd' : '';
  const clang = path.join(bin, `${triple}${api}-clang${ext}`);
  const clangxx = path.join(bin, `${triple}${api}-clang++${ext}`);
  const ar = path.join(bin, `llvm-ar${(platform ?? process.platform) === 'win32' ? '.exe' : ''}`);
  const cargoKey = triple.toUpperCase().replaceAll('-', '_');
  const ccKey = triple.replaceAll('-', '_');
  return {
    [`CARGO_TARGET_${cargoKey}_LINKER`]: clang,
    [`CC_${ccKey}`]: clang,
    [`CXX_${ccKey}`]: clangxx,
    [`AR_${ccKey}`]: ar,
  };
}

/** @param {string} root repository root @param {string} abi */
export function androidOutputPath(root, abi) {
  return joinUnderRoot(
    root,
    'mobile',
    'android',
    'app',
    'src',
    'main',
    'jniLibs',
    abi,
    ANDROID_LIB_NAME,
  );
}

/** Replace `dest` only after the new file is complete (a failed copy keeps the old one). */
function stageFile(/** @type {string} */ src, /** @type {string} */ dest) {
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  copyFileSync(src, tmp);
  chmodSync(tmp, 0o755);
  renameSync(tmp, dest);
}

/**
 * @param {ReturnType<typeof parseMobileArgs>} opts
 * @param {ReturnType<typeof stageSidecarCrate>} stage
 */
async function buildAndroid(opts, stage) {
  const layout = sidecarLayout();
  const ndkRoot = resolveAndroidNdk(process.env);
  if (!ndkRoot) {
    fail('Android NDK not found: set ANDROID_NDK_HOME or install one under <sdk>/ndk/<version>');
  }
  console.debug(LOG_PREFIX, `NDK ${ndkRoot} (API ${ANDROID_MIN_API})`);
  const triples = opts.abis.map((abi) => ANDROID_ABIS[abi]);
  assertRustTargets(triples, stage.crateDir);
  const profile = opts.debug ? 'debug' : 'release';
  const strip = path.join(
    ndkToolBin(ndkRoot),
    `llvm-strip${process.platform === 'win32' ? '.exe' : ''}`,
  );
  for (const abi of opts.abis) {
    const triple = ANDROID_ABIS[abi];
    await run(
      'cargo',
      [
        'build',
        ...(opts.debug ? [] : ['--release']),
        '--manifest-path',
        stage.manifestPath,
        '--target-dir',
        layout.targetDir,
        '--target',
        triple,
        '--features',
        opts.features,
        '--bin',
        'mesh-client-reticulum',
      ],
      { cwd: stage.crateDir, env: androidCargoEnv(ndkRoot, triple) },
    );
    const built = joinUnderRoot(layout.targetDir, triple, profile, 'mesh-client-reticulum');
    if (!existsSync(built)) fail(`Built sidecar missing: ${built}`);
    const dest = androidOutputPath(projectRoot, abi);
    stageFile(built, dest);
    // Strip the staged copy only; target/ keeps symbols for symbolicating crashes.
    if (!opts.debug) await run(strip, ['--strip-all', dest], { cwd: stage.crateDir });
    const size = statSync(dest).size;
    if (size < MIN_SIDECAR_BYTES) fail(`Staged sidecar too small (${size} bytes): ${dest}`);
    console.debug(LOG_PREFIX, `staged ${dest} (${size} bytes, unstripped ${statSync(built).size})`);
  }
}

// --- iOS ---------------------------------------------------------------------------------

/** Keep the FFI crate on the reviewed dependency versions (its Cargo.lock is gitignored). */
function seedFfiLockfile() {
  const { sidecarDir, ffiDir } = sidecarLayout();
  mkdirSync(ffiDir, { recursive: true });
  copyFileSync(joinUnderRoot(sidecarDir, 'Cargo.lock'), joinUnderRoot(ffiDir, 'Cargo.lock'));
}

/** @param {string} features */
function ffiCargoArgs(features) {
  const { ffiDir, targetDir } = sidecarLayout();
  return [
    '--manifest-path',
    joinUnderRoot(ffiDir, 'Cargo.toml'),
    '--target-dir',
    targetDir,
    '--features',
    features,
  ];
}

const IOS_ENV = { IPHONEOS_DEPLOYMENT_TARGET: IOS_DEPLOYMENT_TARGET };

/**
 * @param {ReturnType<typeof parseMobileArgs>} opts
 * @param {ReturnType<typeof stageSidecarCrate>} stage
 */
async function checkIos(opts, stage) {
  assertRustTargets(opts.iosTargets, stage.crateDir);
  seedFfiLockfile();
  for (const target of opts.iosTargets) {
    await run('cargo', ['check', '--target', target, ...ffiCargoArgs(opts.features)], {
      cwd: stage.crateDir,
      env: IOS_ENV,
    });
  }
}

/**
 * @param {ReturnType<typeof parseMobileArgs>} opts
 * @param {ReturnType<typeof stageSidecarCrate>} stage
 */
async function buildIos(opts, stage) {
  const { ffiDir, targetDir } = sidecarLayout();
  const cwd = stage.crateDir;
  const targets = [IOS_DEVICE_TARGET, ...IOS_SIMULATOR_TARGETS];
  assertRustTargets(targets, cwd);
  seedFfiLockfile();
  const profile = opts.debug ? 'debug' : 'release';
  const release = opts.debug ? [] : ['--release'];
  for (const target of IOS_SIMULATOR_TARGETS) {
    await run('cargo', ['build', ...release, '--target', target, ...ffiCargoArgs(opts.features)], {
      cwd,
      env: IOS_ENV,
    });
  }
  // Device slice via `cargo rustc` so the linker inputs Swift needs are printed; touching the
  // FFI root forces that final crate to relink even when nothing changed.
  const now = new Date();
  utimesSync(joinUnderRoot(ffiDir, 'src', 'lib.rs'), now, now);
  const stderr = await run(
    'cargo',
    [
      'rustc',
      ...release,
      '--lib',
      '--target',
      IOS_DEVICE_TARGET,
      ...ffiCargoArgs(opts.features),
      '--',
      '--print',
      'native-static-libs',
    ],
    { cwd, env: IOS_ENV, captureStderr: true },
  );
  const nativeLibs = /native-static-libs: (.*)/.exec(stderr)?.[1]?.trim();

  const lib = (/** @type {string} */ target) =>
    joinUnderRoot(targetDir, target, profile, IOS_STATICLIB);
  for (const target of targets) {
    if (!existsSync(lib(target))) fail(`Built library missing: ${lib(target)}`);
  }
  const simDir = joinUnderRoot(targetDir, 'ios-simulator-universal', profile);
  mkdirSync(simDir, { recursive: true });
  const simLib = joinUnderRoot(simDir, IOS_STATICLIB);
  await run('/usr/bin/lipo', ['-create', ...IOS_SIMULATOR_TARGETS.map(lib), '-output', simLib], {
    cwd,
  });

  const headers = joinUnderRoot(ffiDir, 'include');
  const out = joinUnderRoot(projectRoot, ...IOS_XCFRAMEWORK.split('/'));
  const staging = `${out}.partial`;
  rmSync(staging, { recursive: true, force: true });
  await run(
    '/usr/bin/xcodebuild',
    [
      '-create-xcframework',
      '-library',
      lib(IOS_DEVICE_TARGET),
      '-headers',
      headers,
      '-library',
      simLib,
      '-headers',
      headers,
      '-output',
      staging,
    ],
    { cwd },
  );
  rmSync(out, { recursive: true, force: true });
  renameSync(staging, out);
  console.debug(LOG_PREFIX, `wrote ${out}`);
  console.debug(
    LOG_PREFIX,
    `link with: ${nativeLibs ?? '(not printed; see rustc output above)'} (Swift: import MeshReticulum)`,
  );
}

async function main() {
  let opts;
  try {
    opts = parseMobileArgs(process.argv.slice(2));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  if (opts.platform === 'ios' && !opts.check && process.platform !== 'darwin') {
    fail('iOS libraries need macOS + Xcode; on other hosts use `ios --check` to type-check');
  }
  if (!opts.skipClone) cloneRatspeakStack();
  const stage = stageForBuild();
  if (opts.platform === 'stage') {
    seedFfiLockfile();
    console.debug(LOG_PREFIX, `OK (stage ${stage.manifestPath})`);
    return;
  }
  if (opts.platform === 'android') await buildAndroid(opts, stage);
  else if (opts.check) await checkIos(opts, stage);
  else await buildIos(opts, stage);
  console.debug(LOG_PREFIX, `OK (${opts.platform}, features ${opts.features || '(stub)'})`);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    console.error(LOG_PREFIX, 'Unexpected error:', e);
    process.exit(1);
  });
}
