#!/usr/bin/env node
/**
 * Gate Rust crate licenses for the Reticulum sidecar via `cargo metadata`.
 *
 * Inventory: every package resolved by `reticulum-sidecar/Cargo.lock` with
 * `--locked --all-features`. `--all-features` is required: the Ratspeak stack
 * path deps (rsLXST, rsNomad, lrgp-rs) are optional and are omitted otherwise.
 * Do not add `--offline`; cold caches need the registry index.
 *
 * Allow decisions reuse `isLicenseAllowed()` / `ALLOWED_LICENSE_IDS` from
 * check-licenses.mjs (SPDX OR/AND plus Cargo-style `/`).
 *
 * Failure points:
 * - `cargo` missing: skip with a notice (exit 0) unless `--require-cargo`
 *   (release pre-flight), which exits 1.
 * - `.rsstack/` missing: exit 1 (run scripts/clone-ratspeak-stack.sh).
 * - `cargo metadata` failure or malformed JSON: exit 1 with the error.
 *
 * Usage: pnpm run check:rust-licenses [-- --require-cargo]
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOWED_LICENSE_IDS, isLicenseAllowed } from './check-licenses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SIDECAR_DIR = path.join(ROOT, 'reticulum-sidecar');
export const RSSTACK_DIR = path.join(ROOT, '.rsstack');
export const CARGO_METADATA_ARGS = Object.freeze([
  'metadata',
  '--format-version',
  '1',
  '--locked',
  '--all-features',
]);

/**
 * @typedef {{ name: string, version: string, license: string, manifestPath: string }} RustPackage
 * @typedef {{ license: string, name: string, versions: string[] }} RustLicenseViolation
 * @typedef {{ counts: Map<string, number>, packages: RustPackage[], violations: RustLicenseViolation[] }} RustLicenseEvaluation
 */

/**
 * Reviewed `license-file` bodies (sha256 of exact UTF-8 text) from the pinned
 * Ratspeak stack. Prefer digest match so a header-only near-miss cannot pass.
 * Bump digests when `pnpm run update` advances pins and the LICENSE text changes.
 */
export const APPROVED_LICENSE_FILE_DIGESTS = Object.freeze({
  // .rsstack/rsReticulum/LICENSE (1.4.0)
  fdd4e715eca4170cee9cc96c45b4d45bad6e56c8a264cd2753b8e010a2d9386d: 'LicenseRef-Reticulum',
  // .rsstack/rsLXMF/LICENSE (1.4.0) — same grant, LXMF upstream URL
  '0bf73a7f75b4c3a2e759fbb5ee90fb88e5a6f5bca20dd0e308c84b37ff85b9c9': 'LicenseRef-Reticulum',
  // .rsstack/rsLXST/LICENSE (0.3.1)
  c593187a2c5294de0c9ac229f2c6f5b1aa9d4a771c974bbbd82824c4c1e98276: 'LicenseRef-LXST-Ratspeak',
  // .rsstack/rsNomad/LICENSE (AGPL-3.0 full text)
  '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0': 'AGPL-3.0-or-later',
});

/**
 * Map a cargo `license-file` body to an allowlisted SPDX/LicenseRef id.
 * Ratspeak 1.4 crates dropped SPDX `license =` in favor of `license-file`.
 * Header phrases alone are not enough — require a reviewed digest or the
 * complete structural markers of an approved text.
 *
 * @param {string} body
 * @returns {string} empty when unrecognized
 */
export function classifyLicenseFileBody(body) {
  const text = String(body || '');
  if (!text) return '';
  const digest = createHash('sha256').update(text, 'utf8').digest('hex');
  const approved = APPROVED_LICENSE_FILE_DIGESTS[digest];
  if (approved) return approved;

  // Structural fallbacks for complete texts not yet pinned by digest (e.g. local
  // fixtures). Header-only / truncated bodies must still return ''.
  if (
    text.startsWith('Reticulum License') &&
    text.includes('Permission is hereby granted, free of charge') &&
    text.includes('purposefully do harm to human beings') &&
    text.includes('THE SOFTWARE IS PROVIDED "AS IS"') &&
    text.length >= 800
  ) {
    return 'LicenseRef-Reticulum';
  }
  if (
    text.includes('LXST Copyright') &&
    /non-commercial use only/i.test(text) &&
    /No derivatives or use outside Ratspeak is permitted/i.test(text) &&
    text.length >= 200
  ) {
    return 'LicenseRef-LXST-Ratspeak';
  }
  if (
    /^\s*GNU AFFERO GENERAL PUBLIC LICENSE/m.test(text) &&
    /Version 3,\s*19 November 2007/.test(text) &&
    text.includes('END OF TERMS AND CONDITIONS') &&
    text.length >= 10_000
  ) {
    return 'AGPL-3.0-or-later';
  }
  return '';
}

/**
 * @param {string} manifestPath
 * @param {string} licenseFileRel
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 * @returns {string}
 */
export function resolveLicenseFile(manifestPath, licenseFileRel, io = {}) {
  const readFileSync = io.readFileSync ?? fs.readFileSync;
  const existsSync = io.existsSync ?? fs.existsSync;
  if (!manifestPath || !licenseFileRel) return '';
  const abs = path.resolve(path.dirname(manifestPath), licenseFileRel);
  if (!existsSync(abs)) return '';
  try {
    return classifyLicenseFileBody(readFileSync(abs, 'utf8'));
  } catch {
    return '';
  }
}

/**
 * @param {{ spawn?: typeof spawnSync }} [io]
 * @returns {boolean}
 */
export function isCargoAvailable(io = {}) {
  const spawn = io.spawn ?? spawnSync;
  const result = spawn('cargo', ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return !result.error && result.status === 0;
}

/**
 * Run `cargo metadata` for the sidecar and return the parsed JSON.
 *
 * @param {{ spawn?: typeof spawnSync, cwd?: string }} [io]
 * @returns {unknown}
 */
export function runCargoMetadata(io = {}) {
  const spawn = io.spawn ?? spawnSync;
  const result = spawn('cargo', [...CARGO_METADATA_ARGS], {
    cwd: io.cwd ?? SIDECAR_DIR,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`check:rust-licenses: failed to spawn cargo: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = String(result.stderr || result.stdout || '')
      .trim()
      .split('\n')
      .slice(-20)
      .join('\n');
    throw new Error(`check:rust-licenses: cargo metadata failed (${result.status}): ${err}`);
  }
  const text = String(result.stdout || '').trim();
  if (!text) throw new Error('check:rust-licenses: cargo metadata produced no JSON');
  return JSON.parse(text);
}

/**
 * @param {unknown} metadata Parsed `cargo metadata --format-version 1` output.
 * @returns {RustPackage[]}
 */
export function collectRustPackages(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('check:rust-licenses: expected cargo metadata JSON object');
  }
  const packages = /** @type {Record<string, unknown>} */ (metadata).packages;
  if (!Array.isArray(packages)) {
    throw new Error('check:rust-licenses: cargo metadata is missing a packages array');
  }
  return packages.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('check:rust-licenses: expected package object in cargo metadata');
    }
    const rec = /** @type {Record<string, unknown>} */ (entry);
    const manifestPath = typeof rec.manifest_path === 'string' ? rec.manifest_path : '';
    let license = typeof rec.license === 'string' ? rec.license.trim() : '';
    if (!license && typeof rec.license_file === 'string' && rec.license_file.trim()) {
      license = resolveLicenseFile(manifestPath, rec.license_file.trim());
    }
    return {
      name: typeof rec.name === 'string' ? rec.name : '(unknown)',
      version: typeof rec.version === 'string' ? rec.version : '',
      license,
      manifestPath,
    };
  });
}

/**
 * @param {RustPackage[]} packages
 * @param {readonly string[]} [allowedIds]
 * @returns {RustLicenseEvaluation}
 */
export function evaluateRustPackages(packages, allowedIds = ALLOWED_LICENSE_IDS) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {RustLicenseViolation[]} */
  const violations = [];
  for (const pkg of packages) {
    const license = pkg.license || 'Unknown';
    counts.set(license, (counts.get(license) ?? 0) + 1);
    if (!isLicenseAllowed(pkg.license, allowedIds)) {
      violations.push({ license, name: pkg.name, versions: pkg.version ? [pkg.version] : [] });
    }
  }
  return { counts, packages, violations };
}

/**
 * @param {RustLicenseEvaluation} evaluation
 * @returns {string}
 */
export function formatRustLicenseCheckReport(evaluation) {
  const { counts, packages, violations } = evaluation;
  const lines = [
    `check:rust-licenses: ${packages.length} crates across ${counts.size} license string(s)`,
  ];
  const sortedCounts = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [license, count] of sortedCounts) {
    lines.push(`  ${count}\t${license}`);
  }
  if (violations.length > 0) {
    lines.push('');
    lines.push('check:rust-licenses: disallowed license(s):');
    for (const pkg of violations) {
      const ver = pkg.versions.length > 0 ? `@${pkg.versions.join(',')}` : '';
      lines.push(`  ${pkg.license}: ${pkg.name}${ver}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @typedef {object} RustLicenseCheckOptions
 * @property {boolean} [requireCargo] Exit 1 instead of skipping when cargo is missing.
 * @property {() => boolean} [cargoAvailable]
 * @property {() => boolean} [rsstackPresent]
 * @property {() => unknown} [loadMetadata]
 * @property {{ write: (chunk: string) => unknown }} [stdout]
 * @property {{ write: (chunk: string) => unknown }} [stderr]
 */

/**
 * @param {RustLicenseCheckOptions} [options]
 * @returns {number}
 */
export function runRustLicenseCheck(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const cargoAvailable = options.cargoAvailable ?? (() => isCargoAvailable());
  const rsstackPresent = options.rsstackPresent ?? (() => fs.existsSync(RSSTACK_DIR));
  const loadMetadata = options.loadMetadata ?? (() => runCargoMetadata());

  if (!cargoAvailable()) {
    if (options.requireCargo) {
      stderr.write('check:rust-licenses: cargo not found on PATH (required by --require-cargo)\n');
      return 1;
    }
    stderr.write(
      'check:rust-licenses: cargo not found on PATH; skipping (install Rust to gate sidecar licenses)\n',
    );
    return 0;
  }

  if (!rsstackPresent()) {
    stderr.write(
      'check:rust-licenses: .rsstack/ not provisioned; run scripts/clone-ratspeak-stack.sh\n',
    );
    return 1;
  }

  try {
    const evaluation = evaluateRustPackages(collectRustPackages(loadMetadata()));
    const report = formatRustLicenseCheckReport(evaluation);
    if (evaluation.violations.length > 0) {
      stderr.write(report);
      return 1;
    }
    stdout.write(report);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runRustLicenseCheck({ requireCargo: process.argv.includes('--require-cargo') }));
}
