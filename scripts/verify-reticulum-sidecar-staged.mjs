#!/usr/bin/env node
/**
 * Pre-dist smoke: assert all staged Reticulum sidecar binaries exist for a platform.
 *
 * Run after scripts/build-reticulum-sidecar-release.mjs and before electron-builder.
 */
import { existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  MIN_SIDECAR_BYTES,
  PLATFORM_TARGETS,
  parseElectronPlatform,
  stagedSidecarPath,
} from './reticulum-sidecar-staging.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** @param {string} msg */
function fail(msg) {
  console.error(`[verify-reticulum-sidecar-staged] ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const platformArg =
    argv.find((a) => a.startsWith('--platform='))?.split('=')[1] ??
    (argv.includes('--platform') ? argv[argv.indexOf('--platform') + 1] : undefined);
  if (!platformArg) {
    fail('Usage: node scripts/verify-reticulum-sidecar-staged.mjs --platform win32|linux|darwin');
  }
  return parseElectronPlatform(platformArg);
}

function main() {
  const platform = parseArgs(process.argv.slice(2));
  const targets = PLATFORM_TARGETS[platform];
  if (!targets?.length) {
    fail(`No staged sidecar targets for platform ${platform}`);
  }

  for (const { archKey } of targets) {
    const sidecarPath = stagedSidecarPath(projectRoot, platform, archKey);
    if (!existsSync(sidecarPath)) {
      fail(`Missing staged sidecar for ${platform}-${archKey}: ${sidecarPath}`);
    }
    const size = statSync(sidecarPath).size;
    if (size < MIN_SIDECAR_BYTES) {
      fail(`Staged sidecar too small for ${platform}-${archKey} (${size} bytes): ${sidecarPath}`);
    }
    console.debug(`[verify-reticulum-sidecar-staged] OK ${platform}-${archKey} (${size} bytes)`);
  }

  console.debug(
    `[verify-reticulum-sidecar-staged] OK — ${targets.length} staged sidecar(s) for ${platform}`,
  );
}

try {
  main();
} catch (e) {
  console.error('[verify-reticulum-sidecar-staged] Unexpected error:', e);
  process.exit(1);
}
