#!/usr/bin/env node
/**
 * Build release Reticulum sidecar binaries and stage per-arch copies for electron-builder.
 *
 * Failure point: cargo fails — exit non-zero so release CI never ships
 * an Electron bundle without the sidecar.
 * Fallback: none; packaging verify scripts assert staged binaries land in unpacked apps.
 */
import { spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, realpathSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseArgs } from 'node:util';
import {
  MIN_SIDECAR_BYTES,
  PLATFORM_TARGETS,
  parseElectronPlatform,
  sidecarBinaryFileName,
  stagedSidecarPath,
} from './ble-sidecar-staging.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const sidecarDir = path.join(projectRoot, 'ble-sidecar');
const SIDECAR_FEATURES = 'gatt-ble';

/** @param {string} msg */
function fail(msg) {
  console.error(`[build-ble-sidecar-release] ${msg}`);
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
  console.debug(`[build-ble-sidecar-release] cargo test --features ${SIDECAR_FEATURES}`);
  run('cargo', ['test', '--features', SIDECAR_FEATURES]);
}

/**
 * Linux x64 hosts cross-compiling aarch64-gnu need multiarch pkg-config + linker.
 * @param {string} cargoTarget
 * @returns {NodeJS.ProcessEnv}
 */
function cargoEnvForTarget(cargoTarget) {
  if (process.platform !== 'linux' || cargoTarget !== 'aarch64-unknown-linux-gnu') {
    return {};
  }
  if (process.arch === 'arm64') {
    return {};
  }
  return {
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER: 'aarch64-linux-gnu-gcc',
    PKG_CONFIG_ALLOW_CROSS: '1',
    PKG_CONFIG_PATH: '/usr/lib/aarch64-linux-gnu/pkgconfig',
  };
}

/** @param {string} cargoTarget @param {import('./ble-sidecar-staging.mjs').ElectronPlatform} platform @param {import('./ble-sidecar-staging.mjs').SidecarArchKey} archKey */
function buildAndStage(cargoTarget, platform, archKey) {
  console.debug(
    `[build-ble-sidecar-release] cargo build --release --target ${cargoTarget} (${platform}-${archKey})`,
  );
  run(
    'cargo',
    ['build', '--release', '--target', cargoTarget, '--features', SIDECAR_FEATURES],
    cargoEnvForTarget(cargoTarget),
  );

  const builtName = sidecarBinaryFileName(platform);
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
  console.debug(`[build-ble-sidecar-release] staged ${destPath} (${size} bytes)`);
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

  if (!skipTests) runSidecarTests();
  for (const { cargoTarget, archKey } of targets) {
    buildAndStage(cargoTarget, platform, archKey);
  }

  console.debug(
    `[build-ble-sidecar-release] OK — staged ${targets.length} sidecar(s) for ${platform}`,
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
    console.error('[build-ble-sidecar-release] Unexpected error:', e);
    process.exit(1);
  }
}
