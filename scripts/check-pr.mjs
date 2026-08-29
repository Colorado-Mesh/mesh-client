#!/usr/bin/env node
/**
 * Comprehensive local gate: full lint, typecheck, strict-shared, full Vitest,
 * and full-feature sidecar check when the branch touches sidecar paths.
 *
 * Usage: pnpm run check:pr
 *
 * Merge-base: origin/main when available; otherwise skips sidecar path detection
 * (still runs sidecar check only if forced via env — not used by default).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SIDECAR_PATH_RE =
  /^(reticulum-sidecar\/|scripts\/check-reticulum-sidecar\.sh|scripts\/clone-ratspeak-stack\.sh|scripts\/check-rsnomad\.sh)/;

/**
 * @param {string} cmd
 * @param {string[]} args
 * @returns {number}
 */
function run(cmd, args) {
  console.error(`check:pr: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(`check:pr: failed to spawn ${cmd}:`, result.error.message);
    return 1;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

/**
 * @param {string} gitArgs
 * @returns {string}
 */
function gitStdout(gitArgs) {
  const result = spawnSync('git', gitArgs.split(' '), {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) return '';
  return (result.stdout ?? '').trim();
}

/**
 * @returns {string | null} merge-base SHA, or null if unavailable
 */
export function resolveOriginMainMergeBase() {
  const hasOriginMain = spawnSync('git', ['rev-parse', '--verify', 'origin/main'], {
    cwd: ROOT,
    stdio: 'ignore',
    shell: false,
  });
  if (hasOriginMain.status !== 0) return null;
  const mb = gitStdout('merge-base HEAD origin/main');
  return mb || null;
}

/**
 * @param {string} mergeBase
 * @returns {string[]}
 */
export function listChangedPathsVsMergeBase(mergeBase) {
  const out = gitStdout(`diff --name-only ${mergeBase}...HEAD`);
  if (!out) return [];
  return out
    .split('\n')
    .map((p) => p.replace(/\\/g, '/'))
    .filter(Boolean);
}

/**
 * @param {Iterable<string>} paths
 * @returns {boolean}
 */
export function branchTouchesSidecar(paths) {
  for (const p of paths) {
    if (SIDECAR_PATH_RE.test(p)) return true;
  }
  return false;
}

/**
 * @returns {number}
 */
export function main() {
  const steps = [
    ['pnpm', ['run', 'lint']],
    ['pnpm', ['run', 'typecheck']],
    ['pnpm', ['run', 'typecheck:strict-shared']],
    ['pnpm', ['run', 'test:run']],
  ];

  for (const [cmd, args] of steps) {
    const code = run(cmd, args);
    if (code !== 0) return code;
  }

  const mergeBase = resolveOriginMainMergeBase();
  if (!mergeBase) {
    console.error(
      'check:pr: skip sidecar path check (origin/main unavailable); run pnpm run check:reticulum-sidecar manually if needed',
    );
    return 0;
  }

  const changed = listChangedPathsVsMergeBase(mergeBase);
  if (branchTouchesSidecar(changed)) {
    const code = run('pnpm', ['run', 'check:reticulum-sidecar']);
    if (code !== 0) return code;
  } else {
    console.error(
      'check:pr: skip check:reticulum-sidecar (no sidecar paths in branch vs origin/main)',
    );
  }

  console.error('check:pr: OK');
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(main());
}
