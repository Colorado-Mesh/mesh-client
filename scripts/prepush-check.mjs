#!/usr/bin/env node
/**
 * Branch-level validation for push gates: files changed since origin/main (plus
 * staged/unstaged), then Prettier, CI ESLint, typecheck, and vitest related.
 *
 * Usage: pnpm run check:changed
 */
import { existsSync } from 'node:fs';
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
  const code = runCheckChanged();
  process.exit(code);
}

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main();
}
