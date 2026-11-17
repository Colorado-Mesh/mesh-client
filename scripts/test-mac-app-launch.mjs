#!/usr/bin/env node
/**
 * CI smoke: launch the packaged macOS .app from the shipped ZIP and prove it boots.
 *
 * Failure point: a signed/notarized bundle can still die at launch (entitlement or
 * hardened-runtime mismatch, sidecar blocked under Contents/Resources, asar path
 * regression) and every structural check still passes.
 * Fallback: hard-fail with the extracted bundle path + mesh-client.log tail so CI
 * uploads diagnostics; no artifact is mutated.
 *
 * Spawns the Mach-O under Contents/MacOS directly (not `open -n` / LaunchServices)
 * so stdio and the exit code stay available to the shared launch engine. A notarized
 * bundle launched from CI has no `com.apple.quarantine` xattr because artifacts
 * arrive via actions/download-artifact, not a browser.
 *
 * Set MESH_CLIENT_KEEP_TEMP=1 to skip rmSync of extract/userData dirs (assertions
 * unchanged). MESH_CLIENT_APP_NAME overrides the productName (default Mesh-client).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  LaunchSmokeError,
  LOG_FILENAME,
  baseLaunchArgs,
  launchAndAssert,
  tailText,
} from './packaged-launch-smoke.mjs';
import {
  collectArchives,
  extractZipToTemp,
  pickPrimaryArchive,
  resolveExpectedMacArch,
  VerificationFailure,
} from './verify-mac-packaging.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');
const APP_NAME = process.env.MESH_CLIENT_APP_NAME || 'Mesh-client';
const KEEP_TEMP = process.env.MESH_CLIENT_KEEP_TEMP === '1';

/** @param {string} msg */
function fail(msg) {
  throw new LaunchSmokeError(msg);
}

/**
 * Prefer archives under `mac-${hostArch}/`, else the primary (largest) match.
 * @param {string[]} matches
 * @param {'x64' | 'arm64'} hostArch
 */
export function pickHostArchZip(matches, hostArch) {
  const scoped = matches.filter((z) => z.replace(/\\/g, '/').includes(`/mac-${hostArch}/`));
  if (scoped.length > 0) {
    return pickPrimaryArchive(scoped);
  }
  return pickPrimaryArchive(matches);
}

/**
 * @param {string} userDataDir
 * @param {string} message
 */
function writeLaunchDiagnostics(userDataDir, message) {
  const runnerTemp = process.env.RUNNER_TEMP || tmpdir();
  const outDir = path.join(runnerTemp, 'mesh-client-mac-launch-diagnostics');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'launch-error.txt'), message, 'utf-8');
  const logPath = path.join(userDataDir, LOG_FILENAME);
  if (existsSync(logPath)) {
    try {
      const text = readFileSync(logPath, 'utf-8');
      writeFileSync(path.join(outDir, LOG_FILENAME), tailText(text, 64 * 1024), 'utf-8');
    } catch {
      // catch-no-log-ok best-effort diagnostics
    }
  }
}

async function main() {
  if (process.platform !== 'darwin') {
    console.debug('[test-mac-app-launch] Skipping on non-macOS host');
    return;
  }

  const zips = collectArchives(releaseDir, '.zip');
  if (zips.length === 0) {
    fail('No macOS ZIP found in release/');
  }

  const hostArch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const matches = zips.filter((z) => resolveExpectedMacArch(z) === hostArch);
  if (matches.length === 0) {
    fail(
      `No ${hostArch} macOS ZIP to launch on ${process.arch} (found: ${zips.map((z) => path.basename(z)).join(', ')})`,
    );
  }

  const zipPath = pickHostArchZip(matches, hostArch);
  const extractDir = mkdtempSync(path.join(tmpdir(), 'mesh-client-mac-launch-'));
  const userDataDir = mkdtempSync(path.join(tmpdir(), `mesh-client-userdata-mac-${hostArch}-`));

  try {
    const bundleRoot = extractZipToTemp(zipPath, extractDir);
    const exec = path.join(bundleRoot, 'Contents', 'MacOS', APP_NAME);
    if (!existsSync(exec)) {
      fail(`Missing macOS launcher: ${exec}`);
    }

    try {
      await launchAndAssert({
        label: 'test-mac-app-launch',
        command: exec,
        args: baseLaunchArgs(userDataDir),
        cwd: bundleRoot,
        env: { ...process.env },
        userDataDir,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      writeLaunchDiagnostics(userDataDir, message);
      throw e;
    }
  } finally {
    if (!KEEP_TEMP) {
      rmSync(extractDir, { recursive: true, force: true });
      rmSync(userDataDir, { recursive: true, force: true });
    } else {
      console.debug(
        `[test-mac-app-launch] MESH_CLIENT_KEEP_TEMP=1 — left ${extractDir} and ${userDataDir}`,
      );
    }
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((err) => {
    if (err instanceof LaunchSmokeError || err instanceof VerificationFailure) {
      console.error(`[test-mac-app-launch] ${err.message}`);
    } else {
      console.error('[test-mac-app-launch] Unexpected error:', err);
    }
    process.exit(1);
  });
}
