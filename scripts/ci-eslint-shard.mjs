#!/usr/bin/env node
/**
 * Run one shard of the full CI ESLint pass.
 *
 * `ci.yaml` fans the lint lane out over a matrix and sets ESLINT_SHARD to `<index>/<total>`.
 * Every shard runs the same type-aware rules, CI config and zero-warning gate as the single
 * `pnpm run lint --concurrency 2 --config eslint.ci.config.mjs` pass that `scripts/release.sh`
 * still runs; only the file list is divided.
 *
 * The file list is every Git-visible file (tracked, plus untracked files Git does not ignore),
 * so no extension list can drift from `eslint.config.mjs`. ESLint itself drops the files it
 * ignores or has no configuration for (`--no-warn-ignored`), which leaves exactly the files
 * `eslint .` lints in a clean checkout.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Upper bound on the matrix size; a typo such as `1/400` should fail, not run 1/400th. */
export const MAX_ESLINT_SHARDS = 16;

/**
 * Flags shared by every shard. Two workers bound memory: each type-aware worker loads its
 * own TypeScript programs.
 */
export const ESLINT_SHARD_ARGS = Object.freeze([
  '--max-warnings',
  '0',
  '--concurrency',
  '2',
  '--config',
  'eslint.ci.config.mjs',
  '--no-warn-ignored',
]);

/**
 * @param {string | undefined} spec `<index>/<total>`, 1-based
 * @returns {{ index: number, total: number }}
 */
export function parseShardSpec(spec) {
  const match = /^([1-9]\d?)\/([1-9]\d?)$/.exec(String(spec ?? '').trim());
  if (!match) {
    throw new Error(
      `[ci-eslint-shard] ESLINT_SHARD must look like 2/4 (got ${JSON.stringify(spec ?? null)})`,
    );
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total > MAX_ESLINT_SHARDS || index > total) {
    throw new Error(
      `[ci-eslint-shard] shard ${String(index)}/${String(total)} is out of range (1..${String(MAX_ESLINT_SHARDS)})`,
    );
  }
  return { index, total };
}

/**
 * Deterministic round-robin over the sorted paths, so neighbouring files (and so each
 * directory and TypeScript project) spread evenly across shards.
 *
 * @param {readonly string[]} files
 * @param {number} index 1-based shard
 * @param {number} total
 * @returns {string[]}
 */
export function selectShardFiles(files, index, total) {
  const sorted = [...new Set(files)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted.filter((_file, position) => position % total === index - 1);
}

/**
 * @param {string} stdout NUL-separated `git ls-files -z` output
 * @returns {string[]}
 */
export function parseGitFileList(stdout) {
  return String(stdout ?? '')
    .split('\0')
    .filter((entry) => entry.length > 0);
}

/**
 * Tracked files plus untracked files Git does not ignore, limited to regular files that
 * exist: a deleted-but-tracked path, a symlink or a submodule directory is not passed on.
 *
 * @param {{ root?: string, spawnSyncFn?: typeof spawnSync }} [opts]
 * @returns {string[]}
 */
export function listGitVisibleFiles(opts = {}) {
  const root = opts.root ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const result = spawnSyncFn(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) {
    throw new Error(`[ci-eslint-shard] failed to spawn git: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    throw new Error(
      `[ci-eslint-shard] git ls-files exited ${String(result.status)}: ${String(result.stderr ?? '').trim()}`,
    );
  }
  return parseGitFileList(result.stdout).filter((file) => {
    const stat = fs.lstatSync(path.join(root, file), { throwIfNoEntry: false });
    return stat?.isFile() === true;
  });
}

/**
 * @param {{
 *   spec?: string
 *   root?: string
 *   spawnSyncFn?: typeof spawnSync
 *   log?: (msg: string) => void
 * }} [opts]
 * @returns {number} ESLint's exit status
 */
export function runEslintShard(opts = {}) {
  const root = opts.root ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const log = opts.log ?? ((msg) => console.debug(msg));
  const { index, total } = parseShardSpec(opts.spec ?? process.env.ESLINT_SHARD);
  const candidates = listGitVisibleFiles({ root, spawnSyncFn });
  if (candidates.length === 0) {
    // An empty list would make every shard pass without linting anything.
    throw new Error('[ci-eslint-shard] git listed no files; refusing to pass an empty lint');
  }
  const files = selectShardFiles(candidates, index, total);
  log(
    `[ci-eslint-shard] shard ${String(index)}/${String(total)}: ` +
      `${String(files.length)} of ${String(candidates.length)} Git-visible files`,
  );
  if (files.length === 0) return 0;

  // Resolve ESLint from this repository, whatever directory is being linted.
  const require = createRequire(import.meta.url);
  const eslintPackageJson = require.resolve('eslint/package.json');
  const eslintBin = path.join(path.dirname(eslintPackageJson), 'bin', 'eslint.js');
  const result = spawnSyncFn(process.execPath, [eslintBin, ...ESLINT_SHARD_ARGS, ...files], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`[ci-eslint-shard] failed to spawn ESLint: ${result.error.message}`, {
      cause: result.error,
    });
  }
  // A signal (for example an out-of-memory kill) leaves status null; never read it as a pass.
  return typeof result.status === 'number' ? result.status : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(runEslintShard());
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
