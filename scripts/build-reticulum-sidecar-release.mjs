#!/usr/bin/env node
/**
 * Build release Reticulum sidecar binaries and stage per-arch copies for electron-builder.
 *
 * Linux release builds use cargo-zigbuild with a glibc 2.35 ABI floor on ubuntu-latest
 * (docs/ci-cd.md#linux-sidecar-glibc). macOS/Windows use plain cargo build.
 *
 * Failure point: cargo or Ratspeak clone fails — exit non-zero so release CI never ships
 * an Electron bundle without the sidecar.
 * Fallback: none; packaging verify scripts assert staged binaries land in unpacked apps.
 */
import { spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseArgs } from 'node:util';
import { linuxZigbuildTarget, MAX_SIDECAR_GLIBC } from './check-reticulum-sidecar-glibc.mjs';
import {
  MIN_SIDECAR_BYTES,
  PLATFORM_TARGETS,
  parseElectronPlatform,
  sidecarBinaryFileName,
  stagedSidecarPath,
} from './reticulum-sidecar-staging.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const sidecarDir = path.join(projectRoot, 'reticulum-sidecar');
const SIDECAR_FEATURES = 'rns-stack,rns-ble,rns-rnode-tcp';

/** @param {string} msg */
function fail(msg) {
  console.error(`[build-reticulum-sidecar-release] ${msg}`);
  process.exit(1);
}

/** @param {string} cmd @param {string[]} args @param {NodeJS.ProcessEnv} [extraEnv] */
function run(cmd, args, extraEnv = {}) {
  const result = spawnSync(cmd, args, {
    cwd: sidecarDir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: process.platform === 'win32',
  });
  if (result.error) {
    fail(`Failed to run ${cmd}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(`${cmd} ${args.join(' ')} exited ${result.status ?? 'null'}`);
  }
}

function runSidecarTests() {
  console.debug(
    `[build-reticulum-sidecar-release] cargo test --features ${SIDECAR_FEATURES} -- --test-threads=1`,
  );
  // Serial threads: Ratspeak vault / identity Argon2 use a process-global lock (Busy otherwise).
  run('cargo', ['test', '--features', SIDECAR_FEATURES, '--', '--test-threads=1']);
}

function cloneRatspeakStack() {
  const scriptPath = path.join(projectRoot, 'scripts', 'clone-ratspeak-stack.sh');
  // Absolute bash path avoids Sonar javascript:S4036 (PATH lookup for OS commands).
  const bash =
    process.platform === 'win32'
      ? [
          String.raw`C:\Program Files\Git\bin\bash.exe`,
          String.raw`C:\Program Files (x86)\Git\bin\bash.exe`,
        ].find((candidate) => existsSync(candidate))
      : '/bin/bash';
  if (!bash) {
    fail(String.raw`Git bash not found (expected under Program Files\Git\bin\bash.exe)`);
  }
  const result = spawnSync(bash, [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT ?? path.join(projectRoot, '.rsstack'),
    },
  });
  if (result.error) {
    fail(`Failed to run clone-ratspeak-stack.sh: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(`clone-ratspeak-stack.sh exited ${result.status ?? 'null'}`);
  }
}

/**
 * Env for Linux builds. Zig is the linker when using cargo-zigbuild; still need
 * multiarch pkg-config for libdbus when cross-compiling aarch64.
 * @param {string} cargoTarget
 * @param {boolean} useZigbuild
 * @returns {NodeJS.ProcessEnv}
 */
export function cargoEnvForTarget(cargoTarget, useZigbuild = false) {
  if (process.platform !== 'linux' || cargoTarget !== 'aarch64-unknown-linux-gnu') {
    return {};
  }
  if (process.arch === 'arm64') {
    return {};
  }
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    PKG_CONFIG_ALLOW_CROSS: '1',
    PKG_CONFIG_PATH: '/usr/lib/aarch64-linux-gnu/pkgconfig',
  };
  // Plain cargo (non-release local) still needs the cross GCC linker.
  if (!useZigbuild) {
    env.CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER = 'aarch64-linux-gnu-gcc';
  }
  return env;
}

/**
 * @param {string} cargoTarget
 * @returns {boolean}
 */
function zigOnPath() {
  const result = spawnSync('zig', ['version'], { encoding: 'utf8' });
  return !result.error && (result.status ?? 1) === 0;
}

/**
 * @returns {boolean}
 */
function cargoZigbuildAvailable() {
  const result = spawnSync('cargo', ['zigbuild', '--help'], {
    encoding: 'utf8',
    cwd: sidecarDir,
  });
  return !result.error && (result.status ?? 1) === 0;
}

/**
 * @param {string} cargoTarget
 * @param {import('./reticulum-sidecar-staging.mjs').ElectronPlatform} platform
 * @param {import('./reticulum-sidecar-staging.mjs').SidecarArchKey} archKey
 */
function buildAndStage(cargoTarget, platform, archKey) {
  const useZigbuild = platform === 'linux';
  if (useZigbuild) {
    if (!zigOnPath()) {
      fail(
        'zig not found on PATH (required for Linux release sidecars). ' +
          'See docs/ci-cd.md#linux-sidecar-glibc',
      );
    }
    if (!cargoZigbuildAvailable()) {
      fail(
        'cargo zigbuild not available (install cargo-zigbuild). ' +
          'See docs/ci-cd.md#linux-sidecar-glibc',
      );
    }
    const zigTarget = linuxZigbuildTarget(cargoTarget);
    console.debug(
      `[build-reticulum-sidecar-release] cargo zigbuild --release --target ${zigTarget} (${platform}-${archKey}; glibc ABI ${MAX_SIDECAR_GLIBC})`,
    );
    run(
      'cargo',
      ['zigbuild', '--release', '--target', zigTarget, '--features', SIDECAR_FEATURES],
      cargoEnvForTarget(cargoTarget, true),
    );
  } else {
    console.debug(
      `[build-reticulum-sidecar-release] cargo build --release --target ${cargoTarget} (${platform}-${archKey})`,
    );
    run(
      'cargo',
      ['build', '--release', '--target', cargoTarget, '--features', SIDECAR_FEATURES],
      cargoEnvForTarget(cargoTarget, false),
    );
  }

  const builtName = sidecarBinaryFileName(platform);
  // zigbuild writes to the Rust triple dir (without the .2.35 suffix).
  const builtPath = path.join(sidecarDir, 'target', cargoTarget, 'release', builtName);
  if (!existsSync(builtPath)) {
    fail(`Built sidecar missing: ${builtPath}`);
  }

  const size = statSync(builtPath).size;
  if (size < MIN_SIDECAR_BYTES) {
    fail(`Built sidecar too small (${size} bytes): ${builtPath}`);
  }

  const destPath = stagedSidecarPath(projectRoot, platform, archKey);
  mkdirSync(path.dirname(destPath), { recursive: true });
  copyFileSync(builtPath, destPath);
  if (platform !== 'win32') {
    chmodSync(destPath, 0o755);
  }
  console.debug(`[build-reticulum-sidecar-release] staged ${destPath} (${size} bytes)`);
}

/** Select one CI target or retain the two-target local build. */
export function parseBuildArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      platform: { type: 'string' },
      arch: { type: 'string' },
      'skip-tests': { type: 'boolean', default: false },
    },
  });
  if (!values.platform) {
    throw new Error('Usage: --platform win32|linux|darwin [--arch x64|arm64 [--skip-tests]]');
  }
  const platform = parseElectronPlatform(values.platform);
  const targets = PLATFORM_TARGETS[platform].filter(
    (target) => !values.arch || target.archKey === values.arch,
  );
  if (!targets.length || values.arch === '') {
    throw new Error(`Unsupported --arch value: ${values.arch}`);
  }
  if (values['skip-tests'] && !values.arch) {
    throw new Error(
      '--skip-tests requires an explicit --arch; native CI jobs retain the host tests',
    );
  }
  return { platform, targets, skipTests: values['skip-tests'] };
}

function main() {
  const { platform, targets, skipTests } = parseBuildArgs(process.argv.slice(2));

  cloneRatspeakStack();
  if (!skipTests) runSidecarTests();
  for (const { cargoTarget, archKey } of targets) {
    buildAndStage(cargoTarget, platform, archKey);
  }

  console.debug(
    `[build-reticulum-sidecar-release] OK — staged ${targets.length} sidecar(s) for ${platform}`,
  );
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (e) {
    console.error('[build-reticulum-sidecar-release] Unexpected error:', e);
    process.exit(1);
  }
}
