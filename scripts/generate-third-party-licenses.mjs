#!/usr/bin/env node
/**
 * Generate docs/third-party-licenses.md from license-report (direct npm deps)
 * plus a Rust sidecar summary from `cargo metadata` (omitted with a note when
 * Cargo is unavailable).
 *
 * Runs `pnpm run check:licenses` first. Do not edit the markdown by hand —
 * use `pnpm run docs:licenses`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectRustPackages, isCargoAvailable, runCargoMetadata } from './check-rust-licenses.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const THIRD_PARTY_LICENSES_PATH = path.join(ROOT, 'docs', 'third-party-licenses.md');
export const LICENSE_REPORT_VERSION = '6.8.5';

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ stdio?: 'inherit' | 'pipe', encoding?: string }} [opts]
 */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    shell: process.platform === 'win32',
    encoding: 'utf8',
    ...opts,
  });
  if (result.error) {
    throw new Error(`docs:licenses: failed to spawn ${cmd}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `docs:licenses: ${cmd} ${args.join(' ')} failed (${result.status})${err ? `: ${err}` : ''}`,
    );
  }
  return result.stdout ?? '';
}

/**
 * @param {'prod' | 'dev'} only
 * @returns {string}
 */
export function runLicenseReportMarkdown(only) {
  return run('pnpm', [
    'dlx',
    `license-report@${LICENSE_REPORT_VERSION}`,
    '--output=markdown',
    `--only=${only}`,
    '--fields=name',
    '--fields=licenseType',
    '--fields=definedVersion',
    '--fields=installedVersion',
    '--fields=link',
  ]);
}

export const RUST_SECTION_UNAVAILABLE_NOTE =
  'Rust crate licenses are gated by `pnpm run check:rust-licenses` (requires Cargo); run it locally to view this table.';

/**
 * GitHub repo for a Ratspeak stack crate checked out under `.rsstack/<repo>/`, or null.
 *
 * @param {string} manifestPath
 * @returns {string | null}
 */
export function rsstackRepoUrl(manifestPath) {
  const match = manifestPath.replace(/\\/g, '/').match(/\/\.rsstack\/([^/]+)\//);
  return match ? `https://github.com/ratspeak/${match[1]}` : null;
}

/**
 * @param {import('./check-rust-licenses.mjs').RustPackage[]} packages
 * @returns {string}
 */
export function buildRustSidecarSection(packages) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const pkg of packages) {
    const license = pkg.license || 'Unknown';
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }
  const summaryRows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([license, count]) => `| ${license} | ${count} |`);

  const stackRows = packages
    .map((pkg) => ({ pkg, url: rsstackRepoUrl(pkg.manifestPath) }))
    .filter((row) => row.url !== null)
    .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
    .map(({ pkg, url }) => {
      const repo = String(url).split('/').pop();
      return `| ${pkg.name} | ${pkg.version} | ${pkg.license || 'Unknown'} | [${repo}](${url}) |`;
    });

  return [
    `Licenses for all ${packages.length} crates resolved by \`reticulum-sidecar/Cargo.lock\` (\`cargo metadata --locked --all-features\`), gated by \`pnpm run check:rust-licenses\`.`,
    '',
    '| License | Crates |',
    '| --- | --- |',
    ...summaryRows,
    '',
    '### Ratspeak stack crates',
    '',
    '| Crate | Version | License | Source |',
    '| --- | --- | --- | --- |',
    ...stackRows,
  ].join('\n');
}

/**
 * Rust sidecar section markdown, or null when cargo / metadata is unavailable.
 * Docs generation must not hard-fail without Rust; `check:rust-licenses` is the gate.
 *
 * @param {{ cargoAvailable?: () => boolean, loadMetadata?: () => unknown }} [io]
 * @returns {string | null}
 */
export function loadRustSidecarSection(io = {}) {
  const cargoAvailable = io.cargoAvailable ?? (() => isCargoAvailable());
  const loadMetadata = io.loadMetadata ?? (() => runCargoMetadata());
  if (!cargoAvailable()) {
    process.stderr.write('docs:licenses: cargo unavailable; Rust section omitted\n');
    return null;
  }
  try {
    return buildRustSidecarSection(collectRustPackages(loadMetadata()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`docs:licenses: ${message}; Rust section omitted\n`);
    return null;
  }
}

/**
 * @param {{ prodTable: string, devTable: string, rustSection?: string | null }} tables
 * @returns {string}
 */
export function buildThirdPartyLicensesMarkdown({ prodTable, devTable, rustSection = null }) {
  const prod = prodTable.trim();
  const dev = devTable.trim();
  const rust = rustSection?.trim() || RUST_SECTION_UNAVAILABLE_NOTE;
  return `# Third-party licenses

This file is generated. Do not edit by hand. After dependency changes, run \`pnpm run docs:licenses\`.

npm tables below list **direct** \`dependencies\` and \`devDependencies\` from
[\`package.json\`](../package.json) (via [license-report](https://www.npmjs.com/package/license-report)).
Transitive npm licenses are enforced by \`pnpm run check:licenses\`; Rust sidecar crates by
\`pnpm run check:rust-licenses\`.

Bundled binaries, fonts, and vendored sources are attributed in [Credits](credits.md).

## Runtime dependencies

${prod}

## Development dependencies

${dev}

## Rust sidecar dependencies

${rust}
`;
}

function defaultCheckLicenses() {
  run(process.execPath, [path.join(ROOT, 'scripts', 'check-licenses.mjs')], { stdio: 'inherit' });
}

function defaultLoadReportTables() {
  process.stderr.write('docs:licenses: license-report --only=prod\n');
  const prodTable = runLicenseReportMarkdown('prod');
  process.stderr.write('docs:licenses: license-report --only=dev\n');
  const devTable = runLicenseReportMarkdown('dev');
  return { prodTable, devTable };
}

/**
 * @param {string} filePath
 */
function defaultFormatMarkdownFile(filePath) {
  run('pnpm', ['exec', 'prettier', '--write', filePath], { stdio: 'inherit' });
}

/**
 * Write markdown to a temp file next to the target, format it, then rename over the target.
 * Leaves the existing target unchanged if formatting or rename fails.
 *
 * @param {string} targetPath
 * @param {string} markdown
 * @param {(filePath: string) => void} formatMarkdownFile
 * @param {typeof fs} fsModule
 */
export function writeFormattedMarkdownAtomically(
  targetPath,
  markdown,
  formatMarkdownFile,
  fsModule = fs,
) {
  const targetDir = path.dirname(targetPath);
  fsModule.mkdirSync(targetDir, { recursive: true });
  const tmpDir = fsModule.mkdtempSync(path.join(targetDir, '.third-party-licenses-'));
  const tmpFile = path.join(tmpDir, 'third-party-licenses.md');
  try {
    fsModule.writeFileSync(tmpFile, markdown, 'utf8');
    formatMarkdownFile(tmpFile);
    fsModule.renameSync(tmpFile, targetPath);
  } finally {
    fsModule.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * @typedef {object} GenerateThirdPartyLicensesOptions
 * @property {() => void} [checkLicenses]
 * @property {() => { prodTable: string, devTable: string }} [loadReportTables]
 * @property {() => string | null} [loadRustSection]
 * @property {(filePath: string) => void} [formatMarkdownFile]
 * @property {string} [targetPath]
 * @property {typeof fs} [fsModule]
 */

/**
 * @param {GenerateThirdPartyLicensesOptions} [options]
 * @returns {number}
 */
export function generateThirdPartyLicenses(options = {}) {
  const checkLicenses = options.checkLicenses ?? defaultCheckLicenses;
  const loadReportTables = options.loadReportTables ?? defaultLoadReportTables;
  const loadRustSection = options.loadRustSection ?? (() => loadRustSidecarSection());
  const formatMarkdownFile = options.formatMarkdownFile ?? defaultFormatMarkdownFile;
  const targetPath = options.targetPath ?? THIRD_PARTY_LICENSES_PATH;
  const fsModule = options.fsModule ?? fs;

  process.stderr.write('docs:licenses: running check:licenses\n');
  try {
    checkLicenses();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 1;
  }

  let prodTable;
  let devTable;
  try {
    ({ prodTable, devTable } = loadReportTables());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 1;
  }

  process.stderr.write('docs:licenses: cargo metadata (Rust sidecar)\n');
  const rustSection = loadRustSection();
  const markdown = buildThirdPartyLicensesMarkdown({ prodTable, devTable, rustSection });
  try {
    writeFormattedMarkdownAtomically(targetPath, markdown, formatMarkdownFile, fsModule);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return 1;
  }

  process.stderr.write(`docs:licenses: wrote ${path.relative(ROOT, targetPath)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(generateThirdPartyLicenses());
}
