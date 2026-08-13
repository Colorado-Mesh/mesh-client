#!/usr/bin/env node
/**
 * Gate npm dependency licenses (direct + transitive) via `pnpm licenses list`.
 *
 * license-checker-rseidelsohn cannot walk this repo's hoisted node_modules:
 * `read-package-json` fails on most manifests (`brace_expansion` ESM interop),
 * so the checker only ever saw one package. pnpm's lockfile license listing is
 * the reliable inventory.
 *
 * SPDX `OR`: allowed if any clause is allowed (caller may choose that license).
 * SPDX `AND`: allowed only if every clause is allowed.
 *
 * Usage: pnpm run check:licenses
 */
import { spawnSync } from 'node:child_process';
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
  return JSON.parse(text);
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
