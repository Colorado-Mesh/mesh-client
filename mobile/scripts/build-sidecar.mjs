#!/usr/bin/env node
/**
 * Build the Reticulum sidecar for the mobile apps.
 *
 *   node scripts/build-mobile-sidecar.mjs android [--abi arm64-v8a,x86_64] [--debug] [--skip-clone]
 *   node scripts/build-mobile-sidecar.mjs ios [--debug] [--skip-clone]          (macOS + Xcode)
 *   node scripts/build-mobile-sidecar.mjs ios --check [--target <triple>,...]   (cargo check, any host)
 *   Common: [--features <cargo features>] (default MOBILE_SIDECAR_FEATURES)
 *
 * Android: the unmodified `mesh-client-reticulum` executable, cross-compiled with the NDK (API
 * 24) and staged as mobile/android/app/src/main/jniLibs/<abi>/libmesh_client_reticulum.so. The
 * MeshProcess plugin execs it from nativeLibraryDir (legacy extracted packaging). The NDK comes
 * from ANDROID_NDK_HOME / ANDROID_NDK_ROOT / NDK_HOME, else the newest <sdk>/ndk/<version> under
 * ANDROID_HOME / ANDROID_SDK_ROOT / the default SDK location. Linkers are passed per invocation
 * through env, so nothing machine-specific is written to the repo.
 *
 * iOS: apps cannot spawn processes, so reticulum-sidecar/ffi (C ABI, include/mesh_reticulum.h)
 * is built as a static library for device + simulator and packaged as
 * mobile/ios/App/MeshReticulum.xcframework for the Swift MeshProcess plugin.
 *
 * Mobile feature set: the full stack without BLE (rns-ble / gatt-ble: btleplug) and without USB
 * serial (serialport is desktop-only in Cargo.toml) — the apps own BLE and USB in native plugins.
 *
 * Failure point: any cargo / NDK / Xcode step exits non-zero. Fallback: none; outputs are only
 * replaced after a successful build, so a failed run leaves the previous staged binary.
 */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { joinUnderRoot } from './lib/path-under-root.mjs';
import { MIN_SIDECAR_BYTES } from './reticulum-sidecar-staging.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const sidecarDir = joinUnderRoot(projectRoot, 'reticulum-sidecar');
const ffiDir = joinUnderRoot(sidecarDir, 'ffi');
const LOG_PREFIX = '[build-mobile-sidecar]';

export const MOBILE_SIDECAR_FEATURES = 'rns-stack,rns-rnode-tcp';
const ANDROID_MIN_API = 24;
const ANDROID_LIB_NAME = 'libmesh_client_reticulum.so';
const IOS_DEPLOYMENT_TARGET = '15.0';
const IOS_XCFRAMEWORK = 'mobile/ios/App/MeshReticulum.xcframework';
const IOS_STATICLIB = 'libmesh_reticulum.a';

/** @type {Record<string, string>} Android ABI → Rust target triple. */
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
 * @param {{ env?: NodeJS.ProcessEnv; cwd?: string; captureStderr?: boolean }} [opts]
 * @returns {Promise<string>} captured stderr ('' unless requested)
 */
function run(cmd, args, { env = {}, cwd = sidecarDir, captureStderr = false } = {}) {
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

/** Fail early with the rustup command when a target's standard library is missing. */
function assertRustTargets(/** @type {string[]} */ triples) {
  const result = spawnSync('rustup', ['target', 'list', '--installed'], {
    cwd: sidecarDir,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return; // no rustup: let cargo report it
  const installed = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()));
  const missing = triples.filter((triple) => !installed.has(triple));
  if (missing.length) fail(`missing Rust targets; run: rustup target add ${missing.join(' ')}`);
}

/**
 * @param {string[]} argv
 * @returns {{ platform: 'android' | 'ios'; abis: string[]; iosTargets: string[]; check: boolean;
 *   debug: boolean; skipClone: boolean; features: string }}
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
  if ((platform !== 'android' && platform !== 'ios') || extra.length) {
    throw new Error(
      'Usage: build-mobile-sidecar.mjs android [--abi arm64-v8a,x86_64] | ios [--check [--target <triple>]] [--debug] [--skip-clone] [--features <list>]',
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

// ─── Android ─────────────────────────────────────────────────────────────────────────────

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

/** @param {string} root @param {string} abi */
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

/** @param {ReturnType<typeof parseMobileArgs>} opts */
async function buildAndroid(opts) {
  const ndkRoot = resolveAndroidNdk(process.env);
  if (!ndkRoot) {
    fail('Android NDK not found: set ANDROID_NDK_HOME or install one under <sdk>/ndk/<version>');
  }
  console.debug(LOG_PREFIX, `NDK ${ndkRoot} (API ${ANDROID_MIN_API})`);
  const triples = opts.abis.map((abi) => ANDROID_ABIS[abi]);
  assertRustTargets(triples);
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
        '--target',
        triple,
        '--features',
        opts.features,
        '--bin',
        'mesh-client-reticulum',
      ],
      { env: androidCargoEnv(ndkRoot, triple) },
    );
    const built = joinUnderRoot(sidecarDir, 'target', triple, profile, 'mesh-client-reticulum');
    if (!existsSync(built)) fail(`Built sidecar missing: ${built}`);
    const dest = androidOutputPath(projectRoot, abi);
    stageFile(built, dest);
    // Strip the staged copy only; target/ keeps symbols for symbolicating crashes.
    if (!opts.debug) await run(strip, ['--strip-all', dest]);
    const size = statSync(dest).size;
    if (size < MIN_SIDECAR_BYTES) fail(`Staged sidecar too small (${size} bytes): ${dest}`);
    console.debug(LOG_PREFIX, `staged ${dest} (${size} bytes, unstripped ${statSync(built).size})`);
  }
}

// ─── iOS ─────────────────────────────────────────────────────────────────────────────────

/** Keep the FFI crate on the reviewed dependency versions (its Cargo.lock is gitignored). */
function seedFfiLockfile() {
  copyFileSync(joinUnderRoot(sidecarDir, 'Cargo.lock'), joinUnderRoot(ffiDir, 'Cargo.lock'));
}

/** @param {string} features */
function ffiCargoArgs(features) {
  return [
    '--manifest-path',
    joinUnderRoot(ffiDir, 'Cargo.toml'),
    '--target-dir',
    joinUnderRoot(sidecarDir, 'target'),
    '--features',
    features,
  ];
}

const IOS_ENV = { IPHONEOS_DEPLOYMENT_TARGET: IOS_DEPLOYMENT_TARGET };

/** @param {ReturnType<typeof parseMobileArgs>} opts */
async function checkIos(opts) {
  assertRustTargets(opts.iosTargets);
  seedFfiLockfile();
  for (const target of opts.iosTargets) {
    await run('cargo', ['check', '--target', target, ...ffiCargoArgs(opts.features)], {
      env: IOS_ENV,
    });
  }
}

/** @param {ReturnType<typeof parseMobileArgs>} opts */
async function buildIos(opts) {
  if (process.platform !== 'darwin') {
    fail('iOS libraries need macOS + Xcode; on other hosts use `ios --check` to type-check');
  }
  const targets = [IOS_DEVICE_TARGET, ...IOS_SIMULATOR_TARGETS];
  assertRustTargets(targets);
  seedFfiLockfile();
  const profile = opts.debug ? 'debug' : 'release';
  const release = opts.debug ? [] : ['--release'];
  for (const target of IOS_SIMULATOR_TARGETS) {
    await run('cargo', ['build', ...release, '--target', target, ...ffiCargoArgs(opts.features)], {
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
    { env: IOS_ENV, captureStderr: true },
  );
  const nativeLibs = /native-static-libs: (.*)/.exec(stderr)?.[1]?.trim();

  const lib = (/** @type {string} */ target) =>
    joinUnderRoot(sidecarDir, 'target', target, profile, IOS_STATICLIB);
  for (const target of targets) {
    if (!existsSync(lib(target))) fail(`Built library missing: ${lib(target)}`);
  }
  const simDir = joinUnderRoot(sidecarDir, 'target', 'ios-simulator-universal', profile);
  mkdirSync(simDir, { recursive: true });
  const simLib = joinUnderRoot(simDir, IOS_STATICLIB);
  await run('/usr/bin/lipo', ['-create', ...IOS_SIMULATOR_TARGETS.map(lib), '-output', simLib]);

  const headers = joinUnderRoot(ffiDir, 'include');
  const out = joinUnderRoot(projectRoot, ...IOS_XCFRAMEWORK.split('/'));
  const staging = `${out}.partial`;
  rmSync(staging, { recursive: true, force: true });
  await run('/usr/bin/xcodebuild', [
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
  ]);
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
  if (!opts.skipClone) cloneRatspeakStack();
  if (opts.platform === 'android') await buildAndroid(opts);
  else if (opts.check) await checkIos(opts);
  else await buildIos(opts);
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
