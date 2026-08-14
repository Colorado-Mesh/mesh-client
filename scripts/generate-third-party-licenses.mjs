#!/usr/bin/env node
/**
 * Generate docs/third-party-licenses.md from license-report (direct npm deps).
 *
 * Runs `pnpm run check:licenses` first. Do not edit the markdown by hand —
 * use `pnpm run docs:licenses`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * @param {{ prodTable: string, devTable: string }} tables
 * @returns {string}
 */
export function buildThirdPartyLicensesMarkdown({ prodTable, devTable }) {
  const prod = prodTable.trim();
  const dev = devTable.trim();
  return `# Third-party licenses

This file is generated. Do not edit by hand. After dependency changes, run \`pnpm run docs:licenses\`.

npm tables below list **direct** \`dependencies\` and \`devDependencies\` from
[\`package.json\`](../package.json) (via [license-report](https://www.npmjs.com/package/license-report)).
Transitive licenses are enforced by \`pnpm run check:licenses\`.

Bundled binaries, fonts, and vendored sources are attributed in [Credits](credits.md).

## Runtime dependencies

${prod}

## Development dependencies

${dev}
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

  const markdown = buildThirdPartyLicensesMarkdown({ prodTable, devTable });
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
