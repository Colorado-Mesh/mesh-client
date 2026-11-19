#!/usr/bin/env node
/**
 * Assert a Linux reticulum sidecar ELF does not require glibc newer than the
 * packaging floor (Ubuntu 22.04 → GLIBC_2.35). Catches accidental builds on
 * ubuntu-latest (24.04 / GLIBC 2.39) that crash instantly on older hosts.
 *
 * Usage:
 *   node scripts/check-reticulum-sidecar-glibc.mjs <path-to-mesh-client-reticulum>
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ubuntu 22.04 floor used by packaging-sidecars Linux jobs.
 * Must stay ≤ host glibc on supported desktops (Pop!_OS/Ubuntu 24.04 ≈ 2.39).
 * 6.9.0 AppImage shipped a ubuntu-latest binary needing GLIBC_2.43 and crashed on Pop 24.04.
 */
export const MAX_SIDECAR_GLIBC = '2.35';

/** @param {string} msg */
function fail(msg) {
  console.error(`[check-reticulum-sidecar-glibc] ${msg}`);
  process.exit(1);
}

/**
 * Compare dotted numeric versions (e.g. 2.35 vs 2.39).
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a<b, 0 if equal, positive if a>b
 */
export function compareDottedVersion(a, b) {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * Parse a dotted version after `GLIBC_` (digits and dots only). Linear scan —
 * avoids nested-quantifier regex (eslint security/detect-unsafe-regex).
 * @param {string} text
 * @param {number} start index of first digit
 * @returns {{ version: string, nextIndex: number } | null}
 */
function readDottedVersionAt(text, start) {
  let i = start;
  let sawDigit = false;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    const isDigit = ch >= 48 && ch <= 57;
    const isDot = ch === 46;
    if (!isDigit && !isDot) break;
    if (isDigit) sawDigit = true;
    i += 1;
  }
  if (!sawDigit) return null;
  return { version: text.slice(start, i), nextIndex: i };
}

/**
 * @param {string} text objdump -T / readelf output
 * @returns {string[]} unique GLIBC_X.Y versions found
 */
export function parseGlibcVersionsFromText(text) {
  const found = new Set();
  const marker = 'GLIBC_';
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(marker, from);
    if (at === -1) break;
    const parsed = readDottedVersionAt(text, at + marker.length);
    if (parsed) {
      found.add(parsed.version);
      from = parsed.nextIndex;
    } else {
      from = at + marker.length;
    }
  }
  return [...found].sort(compareDottedVersion);
}

/**
 * @param {string[]} versions
 * @param {string} [maxVersion=MAX_SIDECAR_GLIBC]
 * @returns {string[]} versions strictly greater than max
 */
export function glibcVersionsAboveFloor(versions, maxVersion = MAX_SIDECAR_GLIBC) {
  return versions.filter((v) => compareDottedVersion(v, maxVersion) > 0);
}

/**
 * Collect dynamic-symbol text via objdump or readelf (binutils on packaging runners).
 * @param {string} binaryPath
 * @returns {string}
 */
export function readElfDynamicSymbolText(binaryPath) {
  const attempts = [
    ['objdump', ['-T', binaryPath]],
    ['readelf', ['-V', binaryPath]],
    ['readelf', ['--dyn-syms', binaryPath]],
  ];
  /** @type {string[]} */
  const errors = [];
  for (const [cmd, args] of attempts) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.error) {
      errors.push(`${cmd}: ${result.error.message}`);
      continue;
    }
    const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if ((result.status ?? 1) === 0 || out.includes('GLIBC_')) {
      return out;
    }
    errors.push(`${cmd} exited ${result.status ?? 'null'}`);
  }
  throw new Error(
    `could not read dynamic symbols from ${binaryPath} (need objdump or readelf): ${errors.join('; ')}`,
  );
}

/**
 * @param {string} binaryPath
 * @param {{ maxGlibc?: string }} [opts]
 * @returns {{ versions: string[]; maxRequired: string | null }}
 */
export function assertSidecarGlibcFloor(binaryPath, opts = {}) {
  const maxGlibc = opts.maxGlibc ?? MAX_SIDECAR_GLIBC;
  if (!existsSync(binaryPath)) {
    throw new Error(`sidecar binary not found: ${binaryPath}`);
  }
  const text = readElfDynamicSymbolText(binaryPath);
  const versions = parseGlibcVersionsFromText(text);
  if (versions.length === 0) {
    // Fully static or unexpected — do not pass silently; packaging expects glibc-linked.
    throw new Error(`no GLIBC_* versions found in ${binaryPath}`);
  }
  const tooNew = glibcVersionsAboveFloor(versions, maxGlibc);
  if (tooNew.length > 0) {
    throw new Error(
      `${binaryPath} requires GLIBC_${tooNew.join(', GLIBC_')} (max allowed GLIBC_${maxGlibc}). ` +
        `Rebuild the Linux sidecar on ubuntu-22.04 (see resolve-release-matrix.mjs --sidecars).`,
    );
  }
  return { versions, maxRequired: versions[versions.length - 1] ?? null };
}

function main() {
  const binaryPath = process.argv[2];
  if (!binaryPath) {
    fail('usage: node scripts/check-reticulum-sidecar-glibc.mjs <sidecar-binary>');
  }
  try {
    const { maxRequired, versions } = assertSidecarGlibcFloor(path.resolve(binaryPath));
    console.debug(
      `[check-reticulum-sidecar-glibc] OK — max GLIBC_${maxRequired} (<= ${MAX_SIDECAR_GLIBC}); saw ${versions.map((v) => `GLIBC_${v}`).join(', ')}`,
    );
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
