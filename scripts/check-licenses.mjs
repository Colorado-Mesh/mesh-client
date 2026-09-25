#!/usr/bin/env node
/**
 * Gate npm dependency licenses (direct + transitive) via `pnpm licenses list`.
 *
 * license-checker-rseidelsohn cannot walk this repo's hoisted node_modules:
 * `read-package-json` fails on most manifests (`brace_expansion` ESM interop),
 * so the checker only ever saw one package. pnpm's lockfile license listing is
 * the reliable inventory.
 *
 * Failure point: pnpm 12 (Rust) `licenses list` often reports every package as
 * `Unknown` when `nodeLinker: hoisted` — reported paths point at a missing
 * `.pnpm/<id>/node_modules/...` layout. Fallback: read each package's
 * `package.json` from the hoisted `node_modules/<name>` tree (and any existing
 * reported path) before evaluating the allowlist.
 *
 * SPDX `OR`: allowed if any clause is allowed (caller may choose that license).
 * SPDX `AND`: allowed only if every clause is allowed.
 *
 * Usage: pnpm run check:licenses
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** SPDX / npm license ids permitted for installed packages. */
export const ALLOWED_LICENSE_IDS = Object.freeze([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
  'EPL-2.0',
  'Hippocratic-2.1',
  'Hippocratic-3.0',
  'BlueOak-1.0.0',
  'Python-2.0',
  // argparse@3+ (via markdown-it@15 / markdownlint-cli2) uses SPDX PSF-2.0.
  'PSF-2.0',
  'Zlib',
  'WTFPL',
  'Public Domain',
  'LGPL',
  'LGPL-2.0',
  'LGPL-2.0-or-later',
  'LGPL-2.1',
  'LGPL-2.1-or-later',
  'LGPL-3.0',
  'LGPL-3.0-or-later',
  // Bundled Meshtastic JS stack (GPL-3.0-only) and project SPDX id.
  'GPL-3.0',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  // Data / exception tables required by the toolchain (caniuse-lite, spdx-*).
  'CC-BY-3.0',
  'CC-BY-4.0',
]);

/**
 * Split an SPDX expression on a top-level operator (ignores parentheses).
 *
 * @param {string} expression
 * @param {'AND' | 'OR'} operator
 * @returns {string[]}
 */
export function splitSpdxTopLevel(expression, operator) {
  const parts = [];
  let depth = 0;
  let current = '';
  const tokens = expression.split(/(\s+)/);
  for (const token of tokens) {
    for (const ch of token) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
    }
    if (depth === 0 && token.trim() === operator) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += token;
  }
  const last = current.trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * Unwrap a single pair of wrapping parentheses when they enclose the whole expression.
 *
 * @param {string} expression
 * @returns {string}
 */
export function unwrapSpdxParens(expression) {
  let text = expression.trim();
  while (text.startsWith('(') && text.endsWith(')')) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (depth === 0 && i < text.length - 1) {
        wrapsAll = false;
        break;
      }
    }
    if (!wrapsAll || depth !== 0) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

/**
 * @param {string} id
 * @returns {string}
 */
function normalizeLicenseId(id) {
  const trimmed = unwrapSpdxParens(id).trim();
  if (/^lgpl$/i.test(trimmed)) return 'LGPL';
  if (/^public domain$/i.test(trimmed)) return 'Public Domain';
  return trimmed;
}

/**
 * @param {string} expression
 * @param {readonly string[]} [allowedIds]
 * @returns {boolean}
 */
export function isLicenseAllowed(expression, allowedIds = ALLOWED_LICENSE_IDS) {
  if (typeof expression !== 'string' || expression.trim() === '') return false;
  const allowed = new Set(allowedIds.map((id) => id.toLowerCase()));

  /**
   * @param {string} expr
   * @returns {boolean}
   */
  function check(expr) {
    const unwrapped = unwrapSpdxParens(expr);
    const orParts = splitSpdxTopLevel(unwrapped, 'OR');
    if (orParts.length > 1) return orParts.some(check);
    const andParts = splitSpdxTopLevel(unwrapped, 'AND');
    if (andParts.length > 1) return andParts.every(check);
    const id = normalizeLicenseId(unwrapped).toLowerCase();
    return allowed.has(id);
  }

  return check(expression);
}

/**
 * Extract an SPDX-ish license string from a package.json-like manifest.
 *
 * @param {Record<string, unknown>} manifest
 * @returns {string}
 */
export function licenseFromPackageManifest(manifest) {
  const license = manifest.license;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (license && typeof license === 'object' && !Array.isArray(license)) {
    const typed = /** @type {Record<string, unknown>} */ (license).type;
    if (typeof typed === 'string' && typed.trim()) return typed.trim();
  }

  const legacy = manifest.licenses;
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
  if (Array.isArray(legacy) && legacy.length > 0) {
    const parts = [];
    for (const entry of legacy) {
      if (typeof entry === 'string' && entry.trim()) {
        parts.push(entry.trim());
        continue;
      }
      if (entry && typeof entry === 'object') {
        const typed = /** @type {Record<string, unknown>} */ (entry).type;
        if (typeof typed === 'string' && typed.trim()) parts.push(typed.trim());
      }
    }
    if (parts.length === 1) return parts[0];
    if (parts.length > 1) return parts.join(' OR ');
  }

  return 'Unknown';
}

/**
 * @param {string} packageName
 * @param {string} root
 * @returns {string}
 */
export function hoistedPackageManifestPath(packageName, root) {
  return path.join(root, 'node_modules', ...packageName.split('/'), 'package.json');
}

/**
 * Candidate install dirs for a package name under hoisted node_modules.
 * Meshtastic JSR overrides also appear as `@meshtastic/<name>`.
 *
 * @param {string} packageName
 * @param {string} root
 * @returns {string[]}
 */
export function candidateHoistedPackageDirs(packageName, root) {
  const dirs = [path.join(root, 'node_modules', ...packageName.split('/'))];
  const jsrMesh = packageName.match(/^@jsr\/meshtastic__(.+)$/);
  if (jsrMesh) {
    dirs.push(path.join(root, 'node_modules', '@meshtastic', jsrMesh[1]));
  }
  return dirs;
}

/**
 * Best-effort SPDX id from a conventional LICENSE file body.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function licenseIdFromLicenseFileText(text) {
  const sample = String(text).slice(0, 8000);
  if (/GNU GENERAL PUBLIC LICENSE/i.test(sample) && /Version 3/i.test(sample)) {
    return 'GPL-3.0-only';
  }
  if (/Apache License/i.test(sample) && /Version 2\.0/i.test(sample)) {
    return 'Apache-2.0';
  }
  if (/MIT License/i.test(sample) || /Permission is hereby granted, free of charge/i.test(sample)) {
    return 'MIT';
  }
  if (
    /BSD 3-Clause/i.test(sample) ||
    /Redistribution and use in source and binary forms/i.test(sample)
  ) {
    return 'BSD-3-Clause';
  }
  if (/ISC License/i.test(sample)) return 'ISC';
  return null;
}

/**
 * Parse `SEE LICENSE IN <filename>` into a basename-only license file name.
 * Rejects empty names and any path separators / parent traversal.
 *
 * @param {string} declaration
 * @returns {string | null}
 */
export function parseSeeLicenseInFilename(declaration) {
  const match = String(declaration).match(/^SEE LICENSE IN\s+(.+)$/i);
  if (!match) return null;
  const name = match[1].trim();
  if (!name || /[/\\]/.test(name) || name.includes('..')) return null;
  return name;
}

/**
 * @param {string} packageDir
 * @param {{ readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [io]
 * @param {string | null} [declaredLicense] License string from pnpm (e.g. SEE LICENSE IN COPYING)
 * @returns {string | null}
 */
function readLicenseFromPackageDir(packageDir, io = {}, declaredLicense = null) {
  const existsSync = io.existsSync ?? fs.existsSync;
  const readFileSync = io.readFileSync ?? fs.readFileSync;
  /** @type {string[]} */
  const declaredNames = [];
  const fromDeclared = parseSeeLicenseInFilename(declaredLicense ?? '');
  if (fromDeclared) declaredNames.push(fromDeclared);

  const manifestPath = path.join(packageDir, 'package.json');
  if (existsSync(manifestPath)) {
    try {
      const raw = readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      if (manifest && typeof manifest === 'object') {
        const fromManifest = licenseFromPackageManifest(
          /** @type {Record<string, unknown>} */ (manifest),
        );
        if (
          fromManifest &&
          !/^unknown$/i.test(fromManifest) &&
          !/^SEE LICENSE IN /i.test(fromManifest)
        ) {
          return fromManifest;
        }
        const seeName = parseSeeLicenseInFilename(fromManifest);
        if (seeName) declaredNames.push(seeName);
      }
    } catch {
      // catch-no-log-ok continue to LICENSE file fallback
    }
  }

  const candidates = [
    ...declaredNames,
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'LICENCE',
    'LICENCE.md',
    'COPYING',
  ];
  const seen = new Set();
  for (const name of candidates) {
    if (seen.has(name)) continue;
    seen.add(name);
    const licensePath = path.join(packageDir, name);
    if (!existsSync(licensePath)) continue;
    try {
      const text = readFileSync(licensePath, 'utf8');
      const detected = licenseIdFromLicenseFileText(text);
      if (detected) return detected;
    } catch {
      // catch-no-log-ok try next candidate
    }
  }
  return null;
}

/**
 * Repair pnpm 12 hoisted `licenses list` output that marks every package Unknown.
 *
 * @param {Record<string, unknown>} licensesJson
 * @param {{ root?: string, readFileSync?: typeof fs.readFileSync, existsSync?: typeof fs.existsSync }} [options]
 * @returns {Record<string, unknown>}
 */
export function enrichPnpmLicensesJson(licensesJson, options = {}) {
  if (!licensesJson || typeof licensesJson !== 'object' || Array.isArray(licensesJson)) {
    throw new Error('check:licenses: expected pnpm licenses JSON object');
  }

  const root = options.root ?? ROOT;
  /** @type {Map<string, Array<Record<string, unknown>>>} */
  const byLicense = new Map();

  for (const [license, entries] of Object.entries(licensesJson)) {
    if (!Array.isArray(entries)) {
      throw new Error(
        `check:licenses: expected array for license ${JSON.stringify(license)}, got ${typeof entries}`,
      );
    }
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        throw new Error(
          `check:licenses: expected package object under ${JSON.stringify(license)}, got ${
            entry === null ? 'null' : typeof entry
          }`,
        );
      }
      const rec = /** @type {Record<string, unknown>} */ ({ ...entry });
      let resolved =
        typeof rec.license === 'string' && rec.license.trim() ? rec.license.trim() : license;

      if (!resolved || /^unknown$/i.test(resolved) || /^SEE LICENSE IN /i.test(resolved)) {
        const paths = Array.isArray(rec.paths)
          ? rec.paths.filter((p) => typeof p === 'string')
          : [];
        /** @type {string[]} */
        const dirs = [...paths];
        if (typeof rec.name === 'string') {
          dirs.push(...candidateHoistedPackageDirs(rec.name, root));
        }
        let fromDisk = null;
        for (const dir of dirs) {
          fromDisk = readLicenseFromPackageDir(dir, options, resolved);
          if (fromDisk && !/^unknown$/i.test(fromDisk) && !/^SEE LICENSE IN /i.test(fromDisk)) {
            break;
          }
        }
        if (fromDisk && fromDisk.trim()) resolved = fromDisk.trim();
        else if (!resolved || /^SEE LICENSE IN /i.test(resolved)) resolved = 'Unknown';
      }

      rec.license = resolved;
      const bucket = byLicense.get(resolved) ?? [];
      bucket.push(rec);
      byLicense.set(resolved, bucket);
    }
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [licenseKey, entries] of [...byLicense.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    out[licenseKey] = entries;
  }
  return out;
}

/**
 * @typedef {{ license: string, name: string, versions: string[] }} LicensePackage
 */

/**
 * @param {Record<string, unknown>} licensesJson
 * @returns {{ counts: Map<string, number>, packages: LicensePackage[], violations: LicensePackage[] }}
 */
export function evaluatePnpmLicensesJson(licensesJson) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {LicensePackage[]} */
  const packages = [];
  /** @type {LicensePackage[]} */
  const violations = [];

  if (!licensesJson || typeof licensesJson !== 'object' || Array.isArray(licensesJson)) {
    throw new Error('check:licenses: expected pnpm licenses JSON object');
  }

  for (const [license, entries] of Object.entries(licensesJson)) {
    if (!Array.isArray(entries)) {
      throw new Error(
        `check:licenses: expected array for license ${JSON.stringify(license)}, got ${typeof entries}`,
      );
    }
    counts.set(license, entries.length);
    const allowed = isLicenseAllowed(license);
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        throw new Error(
          `check:licenses: expected package object under ${JSON.stringify(license)}, got ${
            entry === null ? 'null' : typeof entry
          }`,
        );
      }
      const rec = /** @type {Record<string, unknown>} */ (entry);
      const name = typeof rec.name === 'string' ? rec.name : '(unknown)';
      const versions = Array.isArray(rec.versions)
        ? rec.versions.filter((v) => typeof v === 'string')
        : [];
      const pkg = { license, name, versions };
      packages.push(pkg);
      if (!allowed) violations.push(pkg);
    }
  }

  return { counts, packages, violations };
}

/**
 * @param {{ encoding?: string, shell?: boolean }} [spawnOpts]
 * @returns {Record<string, unknown>}
 */
export function loadPnpmLicensesJson(spawnOpts = {}) {
  const result = spawnSync('pnpm', ['licenses', 'list', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...spawnOpts,
  });
  if (result.error) {
    throw new Error(`check:licenses: failed to spawn pnpm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(`check:licenses: pnpm licenses list failed (${result.status}): ${err}`);
  }
  const text = (result.stdout || '').trim();
  if (!text) throw new Error('check:licenses: pnpm licenses list produced no JSON');
  return enrichPnpmLicensesJson(JSON.parse(text));
}

/**
 * @param {{ counts: Map<string, number>, packages: LicensePackage[], violations: LicensePackage[] }} evaluation
 * @returns {string}
 */
export function formatLicenseCheckReport(evaluation) {
  const { counts, packages, violations } = evaluation;
  const lines = [
    `check:licenses: ${packages.length} packages across ${counts.size} license string(s)`,
  ];
  const sortedCounts = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [license, count] of sortedCounts) {
    lines.push(`  ${count}\t${license}`);
  }
  if (violations.length > 0) {
    lines.push('');
    lines.push('check:licenses: disallowed license(s):');
    for (const pkg of violations) {
      const ver = pkg.versions.length > 0 ? `@${pkg.versions.join(',')}` : '';
      lines.push(`  ${pkg.license}: ${pkg.name}${ver}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @returns {number}
 */
export function runLicenseCheck() {
  try {
    const json = loadPnpmLicensesJson();
    const evaluation = evaluatePnpmLicensesJson(json);
    const report = formatLicenseCheckReport(evaluation);
    if (evaluation.violations.length > 0) {
      process.stderr.write(report);
      return 1;
    }
    process.stdout.write(report);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runLicenseCheck());
}
