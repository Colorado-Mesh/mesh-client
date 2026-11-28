#!/usr/bin/env node
/**
 * Branch-level validation for push gates: files changed since origin/main (plus
 * staged/unstaged), then Prettier, CI ESLint, typecheck, and vitest related.
 *
 * Usage: pnpm run check:changed
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLINT_SHARD_ARGS } from './ci-eslint-shard.mjs';
import { resolveOriginMainMergeBase } from './check-pr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_TS_RE = /\.(?:[cm]?[jt]sx?)$/i;
const PRETTIER_RE = /\.(?:[cm]?[jt]sx?|json|css|md|sh)$/i;
const VITEST_INPUT_RE = /\.(?:[cm]?[jt]sx?|mjs)$/i;

const ESLINT_BATCH = 40;

/** Bump when the cache payload or key inputs change. */
export const PREPUSH_CACHE_VERSION = 2;

/**
 * @param {typeof spawnSync} spawnSyncFn
 * @param {string} cwd
 * @param {string[]} gitArgs
 * @param {string | undefined} input
 * @returns {string | null}
 */
function gitText(spawnSyncFn, cwd, gitArgs, input) {
  const result = spawnSyncFn('git', gitArgs, {
    cwd,
    encoding: 'utf8',
    shell: false,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '');
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function nonEmptyLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Stable identity of everything `check:changed` validates: committed HEAD, the
 * merge-base it diffs against, tracked paths changed vs HEAD, and content hashes
 * of those paths plus untracked files. Returns null when a git command fails so
 * callers skip the cache instead of treating a failed diff as an empty tree.
 * Hashes paths (not the patch body) so a diff larger than spawnSync's buffer
 * cannot collapse the key.
 *
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync, mergeBase?: string | null }} [opts]
 * @returns {string | null}
 */
export function computePrepushCacheKey(opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const mergeBase = opts.mergeBase === undefined ? resolveOriginMainMergeBase() : opts.mergeBase;

  const head = gitText(spawnSyncFn, cwd, ['rev-parse', 'HEAD']);
  if (head == null) return null;
  const trackedList = gitText(spawnSyncFn, cwd, ['diff', '--name-only', 'HEAD']);
  if (trackedList == null) return null;
  const untrackedList = gitText(spawnSyncFn, cwd, ['ls-files', '--others', '--exclude-standard']);
  if (untrackedList == null) return null;
  const trackedPaths = nonEmptyLines(trackedList);
  const untrackedPaths = nonEmptyLines(untrackedList);
  const hashPaths = [...trackedPaths, ...untrackedPaths].filter((rel) =>
    existsSync(path.join(cwd, rel)),
  );
  let contentHashes = '';
  if (hashPaths.length > 0) {
    const hashed = gitText(
      spawnSyncFn,
      cwd,
      ['hash-object', '--stdin-paths'],
      hashPaths.join('\n'),
    );
    if (hashed == null) return null;
    contentHashes = hashed;
  }

  return createHash('sha256')
    .update(head.trim())
    .update('\0')
    .update(mergeBase ?? '')
    .update('\0')
    .update(trackedList)
    .update('\0')
    .update(untrackedList)
    .update('\0')
    .update(contentHashes)
    .digest('hex');
}

/**
 * Cache lives inside the git dir (never tracked, per worktree): `.git/prepush-check-cache.json`.
 *
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync }} [opts]
 * @returns {string | null}
 */
export function resolvePrepushCacheFile(opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const gitDir = gitText(spawnSyncFn, cwd, ['rev-parse', '--absolute-git-dir'])?.trim();
  if (!gitDir) return null;
  return path.join(gitDir, 'prepush-check-cache.json');
}

/**
 * @param {unknown} data
 * @param {string} key
 * @returns {boolean}
 */
export function isPrepushCacheValid(data, key) {
  return (
    Boolean(data) &&
    typeof data === 'object' &&
    /** @type {{ version?: unknown, key?: unknown }} */ (data).version === PREPUSH_CACHE_VERSION &&
    /** @type {{ key?: unknown }} */ (data).key === key
  );
}

/**
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync }} [opts]
 * @returns {unknown}
 */
export function readPrepushCache(opts = {}) {
  const file = resolvePrepushCacheFile(opts);
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    // Corrupt cache is not fatal — rerun the checks.
    console.error('check:changed: ignoring unreadable prepush cache', e.message);
    return null;
  }
}

/**
 * @param {string} key
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync }} [opts]
 */
export function writePrepushCache(key, opts = {}) {
  const file = resolvePrepushCacheFile(opts);
  if (!file) return;
  try {
    writeFileSync(
      file,
      `${JSON.stringify({ version: PREPUSH_CACHE_VERSION, key, validatedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  } catch (e) {
    // A read-only git dir must not fail the push.
    console.error('check:changed: could not write prepush cache', e.message);
  }
}

/**
 * @param {typeof spawnSync} spawnSyncFn
 * @param {string} cwd
 * @param {string[]} gitArgs
 * @returns {string[]}
 */
export function gitPathsFrom(spawnSyncFn, cwd, gitArgs) {
  const result = spawnSyncFn('git', gitArgs, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) return [];
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.replace(/\\/g, '/').trim())
    .filter(Boolean);
}

/**
 * Paths differing from merge-base (committed + index + working tree), plus explicit
 * staged/unstaged names so amends with an empty index are still covered.
 *
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync, mergeBase?: string | null }} [opts]
 * @returns {string[]}
 */
export function collectChangedPathsForCheck(opts = {}) {
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const cwd = opts.cwd ?? ROOT;
  const paths = new Set();

  let mergeBase = opts.mergeBase;
  if (mergeBase === undefined) {
    mergeBase = resolveOriginMainMergeBase();
  }

  let base = mergeBase;
  if (!base) {
    const parent = spawnSyncFn('git', ['rev-parse', '--verify', 'HEAD~1'], {
      cwd,
      encoding: 'utf8',
      shell: false,
    });
    if (parent.status === 0) {
      base = String(parent.stdout ?? '').trim() || null;
    }
  }

  if (base) {
    for (const file of gitPathsFrom(spawnSyncFn, cwd, ['diff', '--name-only', base])) {
      paths.add(file);
    }
  }

  for (const file of gitPathsFrom(spawnSyncFn, cwd, ['diff', '--name-only', 'HEAD'])) {
    paths.add(file);
  }
  for (const file of gitPathsFrom(spawnSyncFn, cwd, ['diff', '--cached', '--name-only'])) {
    paths.add(file);
  }

  return [...paths]
    .filter((file) => existsSync(path.join(cwd, file)))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {number | null | undefined} status
 * @param {NodeJS.Signals | null | undefined} signal
 * @returns {number}
 */
export function spawnExitCode(status, signal) {
  if (signal) return 1;
  return typeof status === 'number' ? status : 1;
}

/**
 * @param {string[]} files repo-relative
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {number}
 */
export function runEslintOnChangedFiles(files, opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const lintTargets = files.filter((file) => JS_TS_RE.test(file));
  if (lintTargets.length === 0) {
    console.error('check:changed: skip eslint (no changed JS/TS files)');
    return 0;
  }

  const eslintEntry = path.join(cwd, 'node_modules/eslint/bin/eslint.js');
  const env = {
    ...process.env,
    ...opts.env,
    NODE_OPTIONS: opts.env?.NODE_OPTIONS ?? process.env.NODE_OPTIONS ?? '--max-old-space-size=6144',
  };

  for (let offset = 0; offset < lintTargets.length; offset += ESLINT_BATCH) {
    const batch = lintTargets.slice(offset, offset + ESLINT_BATCH);
    const result = spawnSyncFn(
      process.execPath,
      [eslintEntry, ...ESLINT_SHARD_ARGS, '--', ...batch],
      { cwd, env, stdio: 'inherit', shell: false },
    );
    const code = spawnExitCode(result.status, result.signal);
    if (code !== 0) {
      if (result.error) {
        console.error('check:changed: eslint spawn failed', result.error.message);
      }
      return code;
    }
  }
  return 0;
}

/**
 * @param {string[]} files
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync }} [opts]
 * @returns {number}
 */
export function runPrettierCheckOnChangedFiles(files, opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const prettyTargets = files.filter((file) => PRETTIER_RE.test(file));
  if (prettyTargets.length === 0) {
    console.error('check:changed: skip prettier (no format-checked paths changed)');
    return 0;
  }

  const result = spawnSyncFn(
    'pnpm',
    ['exec', 'prettier', '--check', '--ignore-unknown', ...prettyTargets],
    { cwd, stdio: 'inherit', shell: false },
  );
  return spawnExitCode(result.status, result.signal);
}

/**
 * @param {string[]} files
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync }} [opts]
 * @returns {number}
 */
export function runVitestRelatedOnChangedFiles(files, opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const related = files.filter((file) => VITEST_INPUT_RE.test(file));
  if (related.length === 0) {
    console.error('check:changed: skip vitest related (no changed source/test paths)');
    return 0;
  }

  const result = spawnSyncFn('pnpm', ['exec', 'vitest', 'related', '--run', ...related], {
    cwd,
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192',
    },
    stdio: 'inherit',
    shell: false,
  });
  return spawnExitCode(result.status, result.signal);
}

/**
 * @param {{ cwd?: string, spawnSyncFn?: typeof spawnSync, mergeBase?: string | null }} [opts]
 * @returns {number}
 */
export function runCheckChanged(opts = {}) {
  const cwd = opts.cwd ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const files = collectChangedPathsForCheck(opts);
  console.error(`check:changed: ${files.length} path(s) vs merge-base (and working tree)`);
  if (files.length === 0) {
    console.error('check:changed: nothing to validate');
    return 0;
  }

  let code = runPrettierCheckOnChangedFiles(files, { cwd, spawnSyncFn });
  if (code !== 0) return code;

  code = runEslintOnChangedFiles(files, { cwd, spawnSyncFn });
  if (code !== 0) return code;

  const typecheck = spawnSyncFn('pnpm', ['run', 'typecheck'], {
    cwd,
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192',
    },
    stdio: 'inherit',
    shell: false,
  });
  code = spawnExitCode(typecheck.status, typecheck.signal);
  if (code !== 0) return code;

  return runVitestRelatedOnChangedFiles(files, { cwd, spawnSyncFn });
}

function main() {
  if (process.env.PREPUSH_CHECK_NO_CACHE === '1') {
    process.exit(runCheckChanged());
  }

  const mergeBase = resolveOriginMainMergeBase();
  const cacheKey = computePrepushCacheKey({ mergeBase });
  if (cacheKey == null) {
    console.error('check:changed: cache key failed — running checks without cache');
    process.exit(runCheckChanged({ mergeBase }));
  }
  if (isPrepushCacheValid(readPrepushCache(), cacheKey)) {
    console.error(
      'check:changed: skip — this exact tree already passed (PREPUSH_CHECK_NO_CACHE=1 forces a rerun)',
    );
    process.exit(0);
  }

  const code = runCheckChanged({ mergeBase });
  if (code === 0) writePrepushCache(cacheKey);
  process.exit(code);
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main();
}
