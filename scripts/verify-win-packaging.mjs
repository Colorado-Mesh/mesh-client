#!/usr/bin/env node
/**
 * Post-dist:win guard — fail CI if Windows packaging omits Mesh-client.exe or ships a
 * universal NSIS installer instead of per-arch Setup exes.
 *
 * Failure point: electron-builder universal NSIS on Windows 11 ARM can extract support
 * files but drop the main exe; split installers avoid arch-selection in NSIS.
 * Fallback: hard fail before publish so a broken Windows release never ships.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { assertBundledReticulumSidecarInBundle } from './assert-bundled-reticulum-sidecar.mjs';
import { assertUpdateYmlArtifacts } from './assert-update-yml-artifacts.mjs';
import { collectWinSetupInstallers } from './win-setup-installer-names.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

const MIN_EXE_BYTES = 50 * 1024 * 1024;
const APP_EXE = 'Mesh-client.exe';

/** @param {string} label @param {string} filePath */
function assertExe(label, filePath) {
  if (!existsSync(filePath)) {
    console.error(`[verify-win-packaging] Missing ${label}: ${filePath}`);
    process.exit(1);
  }
  const size = statSync(filePath).size;
  if (size < MIN_EXE_BYTES) {
    console.error(
      `[verify-win-packaging] ${label} too small (${size} bytes, need >= ${MIN_EXE_BYTES}): ${filePath}`,
    );
    process.exit(1);
  }
}

/** @param {string} msg */
function fail(msg) {
  console.error(`[verify-win-packaging] ${msg}`);
  process.exit(1);
}

function readVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  return packageJson.version;
}

/**
 * Parse the JSON emitted by `Get-AuthenticodeSignature` into a normalized shape.
 * Pure (testable). Accepts the PowerShell object with Status + SignerCertificate.Subject.
 * @param {string} jsonText
 * @returns {{ status: string, subject: string | null }}
 */
export function parseAuthenticodeJson(jsonText) {
  const data = JSON.parse(jsonText);
  const status = String(data?.Status ?? data?.status ?? '');
  const subjectRaw =
    data?.SignerCertificate?.Subject ?? data?.signerCertificate?.subject ?? data?.Subject ?? null;
  return { status, subject: subjectRaw != null ? String(subjectRaw) : null };
}

/**
 * Decide the signature-check outcome for one installer. Mirrors the macOS smoke:
 * when NOT signed → skip (dormant/unsigned builds stay green); when signed → the
 * status must be Valid and, if an expected publisher is given, the cert subject
 * must contain it (CN=... includes the publisher name).
 * Pure (testable).
 * @param {{ status: string, subject: string | null }} sig
 * @param {string | null} [expectedPublisher]
 * @returns {{ action: 'skip' | 'pass' | 'fail', reason: string }}
 */
export function evaluateSignature(sig, expectedPublisher = null) {
  if (sig.status === 'NotSigned') {
    return { action: 'skip', reason: 'NotSigned (unsigned build — signature check skipped)' };
  }
  if (sig.status !== 'Valid') {
    return { action: 'fail', reason: `Authenticode status is "${sig.status}", expected "Valid"` };
  }
  if (expectedPublisher && expectedPublisher.trim().length > 0) {
    const subject = sig.subject ?? '';
    if (!subject.includes(expectedPublisher)) {
      return {
        action: 'fail',
        reason: `signed, but certificate subject (${subject || '(none)'}) does not contain expected publisher "${expectedPublisher}"`,
      };
    }
  }
  return { action: 'pass', reason: `Valid${sig.subject ? ` (${sig.subject})` : ''}` };
}

/**
 * Run Get-AuthenticodeSignature on a file and return parsed status/subject, or null
 * when PowerShell is unavailable (non-Windows host — nothing to verify there).
 * @param {string} filePath
 * @returns {{ status: string, subject: string | null } | null}
 */
function readAuthenticodeSignature(filePath) {
  if (process.platform !== 'win32') return null;
  const psCommand =
    `$ErrorActionPreference='Stop';` +
    `$s = Get-AuthenticodeSignature -LiteralPath '${filePath.replace(/'/g, "''")}';` +
    `[pscustomobject]@{ Status = $s.Status.ToString(); SignerCertificate = ` +
    `(if ($s.SignerCertificate) { [pscustomobject]@{ Subject = $s.SignerCertificate.Subject } } else { $null }) } | ConvertTo-Json -Compress`;
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
    encoding: 'utf-8',
  });
  if (result.status !== 0 || !result.stdout) {
    fail(`Get-AuthenticodeSignature failed for ${filePath}: ${(result.stderr || '').slice(-500)}`);
  }
  return parseAuthenticodeJson(result.stdout.trim());
}

/**
 * Verify an installer's Authenticode signature when the host can (Windows). Skips
 * cleanly on non-Windows hosts and for unsigned builds; fails on invalid/mismatched
 * signatures. Expected publisher comes from AZURE_SIGNING_PUBLISHER_NAME when set.
 * @param {string} label @param {string} filePath
 */
function verifyAuthenticode(label, filePath) {
  const sig = readAuthenticodeSignature(filePath);
  if (sig === null) {
    console.debug(`[verify-win-packaging] ${label} signature check skipped (non-Windows host)`);
    return;
  }
  const expectedPublisher = process.env.AZURE_SIGNING_PUBLISHER_NAME ?? null;
  const outcome = evaluateSignature(sig, expectedPublisher);
  if (outcome.action === 'fail') {
    fail(`${label} Authenticode check failed: ${outcome.reason}`);
  }
  console.debug(`[verify-win-packaging] ${label} signature: ${outcome.reason}`);
}

function collectSetupInstallers(version) {
  if (!existsSync(releaseDir)) {
    console.error(`[verify-win-packaging] Missing release directory: ${releaseDir}`);
    process.exit(1);
  }

  try {
    return collectWinSetupInstallers(version, readdirSync(releaseDir));
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

function main() {
  const version = readVersion();

  assertExe('x64 unpacked app', path.join(releaseDir, 'win-unpacked', APP_EXE));
  assertExe('arm64 unpacked app', path.join(releaseDir, 'win-arm64-unpacked', APP_EXE));
  assertBundledReticulumSidecarInBundle({
    label: 'x64 bundled Reticulum sidecar',
    platform: 'win32',
    bundleRoot: path.join(releaseDir, 'win-unpacked'),
    fail,
  });
  assertBundledReticulumSidecarInBundle({
    label: 'arm64 bundled Reticulum sidecar',
    platform: 'win32',
    bundleRoot: path.join(releaseDir, 'win-arm64-unpacked'),
    fail,
  });

  const installers = collectSetupInstallers(version);
  assertExe('x64 NSIS installer', path.join(releaseDir, installers.x64));
  assertExe('arm64 NSIS installer', path.join(releaseDir, installers.arm64));

  // Conditional Authenticode check: asserts a valid signature + matching publisher
  // when the build is signed (Azure Trusted Signing active); skips for unsigned
  // builds and on non-Windows hosts so dormant/local builds stay green.
  verifyAuthenticode('x64 NSIS installer', path.join(releaseDir, installers.x64));
  verifyAuthenticode('arm64 NSIS installer', path.join(releaseDir, installers.arm64));

  try {
    assertUpdateYmlArtifacts({ rootDir: releaseDir, requiredFiles: ['latest.yml'] });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }

  console.debug(
    `[verify-win-packaging] OK — ${APP_EXE} in win-unpacked + win-arm64-unpacked; installers: ${installers.x64}, ${installers.arm64}`,
  );
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error('[verify-win-packaging] Unexpected error:', e);
    process.exit(1);
  }
}
