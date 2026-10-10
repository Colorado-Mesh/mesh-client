#!/usr/bin/env node
/**
 * Gate Rust crate licenses for the Reticulum sidecar via `cargo metadata`.
 *
 * Inventory: every package resolved by `ble-sidecar/Cargo.lock` with
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
 * - `cargo metadata` failure or malformed JSON: exit 1 with the error.
 *
 * Usage: pnpm run check:rust-licenses [-- --require-cargo]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALLOWED_LICENSE_IDS, isLicenseAllowed } from './check-licenses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SIDECAR_DIR = path.join(ROOT, 'ble-sidecar');
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
    return {
      name: typeof rec.name === 'string' ? rec.name : '(unknown)',
      version: typeof rec.version === 'string' ? rec.version : '',
      license: typeof rec.license === 'string' ? rec.license.trim() : '',
      manifestPath: typeof rec.manifest_path === 'string' ? rec.manifest_path : '',
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
