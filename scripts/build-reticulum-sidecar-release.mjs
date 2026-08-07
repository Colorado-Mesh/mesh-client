#!/usr/bin/env node
/**
 * Build release Reticulum sidecar binaries and stage per-arch copies for electron-builder.
 *
 * Failure point: cargo or Ratspeak clone fails — exit non-zero so release CI never ships
 * an Electron bundle without the sidecar.
 * Fallback: none; packaging verify scripts assert staged binaries land in unpacked apps.
 */
import { spawnSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
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
  console.debug(`[build-reticulum-sidecar-release] cargo test --features ${SIDECAR_FEATURES}`);
  run('cargo', ['test', '--features', SIDECAR_FEATURES]);
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

/** @param {string} cargoTarget @param {import('./reticulum-sidecar-staging.mjs').ElectronPlatform} platform @param {import('./reticulum-sidecar-staging.mjs').SidecarArchKey} archKey */
function buildAndStage(cargoTarget, platform, archKey) {
  console.debug(
    `[build-reticulum-sidecar-release] cargo build --release --target ${cargoTarget} (${platform}-${archKey})`,
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
  console.debug(`[build-reticulum-sidecar-release] staged ${destPath} (${size} bytes)`);
}

function parseArgs(argv) {
  const platformArg =
    argv.find((a) => a.startsWith('--platform='))?.split('=')[1] ??
    (argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : undefined);
  if (!platformArg) {
    fail('Usage: node scripts/build-reticulum-sidecar-release.mjs --platform win32|linux|darwin');
  }
  return parseElectronPlatform(platformArg);
}

function main() {
  const platform = parseArgs(process.argv.slice(2));
  const targets = PLATFORM_TARGETS[platform];
  if (!targets?.length) {
    fail(`No sidecar targets configured for platform ${platform}`);
  }

  cloneRatspeakStack();
  runSidecarTests();
  for (const { cargoTarget, archKey } of targets) {
    buildAndStage(cargoTarget, platform, archKey);
  }

  console.debug(
    `[build-reticulum-sidecar-release] OK — staged ${targets.length} sidecar(s) for ${platform}`,
  );
}

try {
  main();
} catch (e) {
  console.error('[build-reticulum-sidecar-release] Unexpected error:', e);
  process.exit(1);
}
