#!/usr/bin/env node
/**
 * Pre-commit Vitest selector: run only tests related to staged files.
 *
 * - Force full suite for vitest infra / dependency manifests.
 * - Otherwise `vitest related` on staged source/test paths (+ co-located siblings).
 * - Restrict `--project` when the staged set clearly maps to one/few projects.
 * - Skip Vitest when no relevant staged paths (docs-only, etc.).
 *
 * Failure point: vitest exit non-zero → propagate to pre-commit.
 * Fallback: ambiguous project mapping runs all three projects.
 * Logging: selected mode, file count, and projects to stderr.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** @typedef {'renderer-ui' | 'renderer-logic' | 'main'} VitestProject */

const SOURCE_EXT_RE = /\.(?:[cm]?[jt]sx?)$/i;
const TEST_SIBLING_RE = /\.test\.(?:[cm]?[jt]sx?)$/i;

/** Central source-policy suite — always related when any TypeScript under src/ is staged. */
export const SOURCE_POLICY_TEST_PATH = 'src/architecture/sourcePolicy.test.ts';
const SRC_TS_PATH_RE = /^src\/.+\.(?:ts|tsx)$/;

const FORCE_FULL_PATTERNS = [
  /^vitest\.config\./,
  /^vitest\.harness(\.|$)/,
  /^src\/renderer\/vitest\.setup/,
  /^src\/renderer\/vitest\.electronApiMock/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
];

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isForceFullSuitePath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return FORCE_FULL_PATTERNS.some((re) => re.test(normalized));
}

/**
 * @param {Iterable<string>} stagedPaths
 * @returns {boolean}
 */
export function shouldForceFullSuite(stagedPaths) {
  for (const p of stagedPaths) {
    if (isForceFullSuitePath(p)) return true;
  }
  return false;
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isVitestRelevantPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (isForceFullSuitePath(normalized)) return true;
  if (SOURCE_EXT_RE.test(normalized)) return true;
  return false;
}

/**
 * When a non-test source file is staged, also include co-located `*.test.*` siblings.
 * @param {string[]} stagedPaths
 * @param {{ existsSync?: (p: string) => boolean, root?: string }} [opts]
 * @returns {string[]}
 */
export function expandWithSiblingTests(stagedPaths, opts = {}) {
  const existsSync = opts.existsSync ?? fs.existsSync;
  const root = opts.root ?? ROOT;
  const out = new Set();

  for (const raw of stagedPaths) {
    const normalized = raw.replace(/\\/g, '/');
    if (!isVitestRelevantPath(normalized)) continue;
    out.add(normalized);

    if (TEST_SIBLING_RE.test(normalized)) continue;

    const dir = path.posix.dirname(normalized);
    const base = path.posix.basename(normalized);
    const stem = base.replace(SOURCE_EXT_RE, '');
    const siblingCandidates = [
      `${dir}/${stem}.test.ts`,
      `${dir}/${stem}.test.tsx`,
      `${dir}/${stem}.test.mjs`,
      `${dir}/${stem}.test.js`,
      `${dir}/${stem}.test.jsx`,
      `${dir}/${stem}.test.mts`,
      `${dir}/${stem}.test.cts`,
    ];
    for (const candidate of siblingCandidates) {
      const abs = path.join(root, candidate);
      if (existsSync(abs)) out.add(candidate);
    }
  }

  return [...out].sort();
}

/**
 * Registry walker is not imported by production files, so `vitest related` would
 * miss it. Append whenever any TypeScript under `src/` is in the related set.
 * @param {string[]} relatedPaths
 * @returns {string[]}
 */
export function appendSourcePolicyTestIfNeeded(relatedPaths) {
  const normalized = relatedPaths.map((p) => p.replace(/\\/g, '/'));
  const needsPolicy = normalized.some((p) => SRC_TS_PATH_RE.test(p));
  if (!needsPolicy) return [...relatedPaths].sort();
  if (normalized.includes(SOURCE_POLICY_TEST_PATH)) return [...normalized].sort();
  return [...normalized, SOURCE_POLICY_TEST_PATH].sort();
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isMainProjectPath(filePath) {
  const p = filePath.replace(/\\/g, '/');
  return (
    p.startsWith('src/main/') ||
    p.startsWith('src/shared/') ||
    p.startsWith('src/preload/') ||
    p.startsWith('src/architecture/') ||
    p.startsWith('scripts/') ||
    p === 'vitest.harness.ts' ||
    p === 'vitest.harness.test.ts'
  );
}

/**
 * Pick Vitest projects for a related-file set.
 * Ambiguous / unknown paths fall back to all three projects.
 * @param {string[]} relatedPaths
 * @returns {VitestProject[]}
 */
export function pickProjects(relatedPaths) {
  if (relatedPaths.length === 0) return [];

  const normalized = relatedPaths.map((p) => p.replace(/\\/g, '/'));

  const onlyMain = normalized.every((p) => isMainProjectPath(p));
  if (onlyMain) return ['main'];

  const onlyRendererLibOrStores = normalized.every(
    (p) =>
      p.startsWith('src/renderer/lib/') ||
      p.startsWith('src/renderer/stores/') ||
      p === 'src/renderer/locales/locale-quality.test.ts' ||
      p === SOURCE_POLICY_TEST_PATH,
  );
  if (onlyRendererLibOrStores) {
    // Logic owns most lib tests; UI owns borderline lib exclusions — run both.
    // Source-policy lives in the main project; include it when appended.
    if (normalized.includes(SOURCE_POLICY_TEST_PATH)) {
      return ['renderer-logic', 'renderer-ui', 'main'];
    }
    return ['renderer-logic', 'renderer-ui'];
  }

  const onlyRendererOrPolicy = normalized.every(
    (p) => p.startsWith('src/renderer/') || p === SOURCE_POLICY_TEST_PATH,
  );
  if (onlyRendererOrPolicy) {
    if (normalized.includes(SOURCE_POLICY_TEST_PATH)) {
      return ['renderer-ui', 'renderer-logic', 'main'];
    }
    return ['renderer-ui', 'renderer-logic'];
  }

  const hasMain = normalized.some((p) => isMainProjectPath(p));
  const hasRenderer = normalized.some((p) => p.startsWith('src/renderer/'));
  if (hasMain && hasRenderer) return ['renderer-ui', 'renderer-logic', 'main'];
  if (hasMain) return ['main'];
  if (hasRenderer) return ['renderer-ui', 'renderer-logic'];

  return ['renderer-ui', 'renderer-logic', 'main'];
}

/**
 * @param {string[]} stagedPaths
 * @returns {{ mode: 'full' | 'related' | 'skip', relatedPaths: string[], projects: VitestProject[] }}
 */
export function planPrecommitTests(stagedPaths) {
  if (shouldForceFullSuite(stagedPaths)) {
    return {
      mode: 'full',
      relatedPaths: [],
      projects: ['renderer-ui', 'renderer-logic', 'main'],
    };
  }

  const relatedPaths = appendSourcePolicyTestIfNeeded(expandWithSiblingTests(stagedPaths));
  if (relatedPaths.length === 0) {
    return { mode: 'skip', relatedPaths: [], projects: [] };
  }

  return {
    mode: 'related',
    relatedPaths,
    projects: pickProjects(relatedPaths),
  };
}

/**
 * Resolve the local Vitest CLI entry so we can spawn without a shell.
 * @param {string} [root]
 * @returns {string}
 */
export function resolveVitestCli(root = ROOT) {
  return path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
}

/**
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   spawnSyncFn?: typeof spawnSync,
 *   vitestCli?: string,
 *   execPath?: string,
 * }} [opts]
 * @returns {number}
 */
export function runVitestArgv(args, opts = {}) {
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const cwd = opts.cwd ?? ROOT;
  const vitestCli = opts.vitestCli ?? resolveVitestCli(cwd);
  const execPath = opts.execPath ?? process.execPath;
  // Shell-free: staged paths must stay literal argv (Windows cmd metacharacters).
  const result = spawnSyncFn(execPath, [vitestCli, ...args], {
    cwd,
    env: opts.env ?? process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error('precommit-tests: failed to spawn vitest:', result.error.message);
    return 1;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

/**
 * @param {string[]} stagedPaths
 * @param {{
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   spawnSyncFn?: typeof spawnSync,
 *   log?: (msg: string) => void,
 * }} [opts]
 * @returns {number}
 */
export function runPrecommitTests(stagedPaths, opts = {}) {
  const log = opts.log ?? ((msg) => console.error(msg));
  const plan = planPrecommitTests(stagedPaths);

  if (plan.mode === 'skip') {
    log('precommit-tests: skip Vitest (no staged source/test files)');
    return 0;
  }

  if (plan.mode === 'full') {
    log('precommit-tests: full suite (vitest infra or dependency manifests staged)');
    return runVitestArgv(['run', '--bail', '1'], opts);
  }

  const projectArgs = plan.projects.flatMap((p) => ['--project', p]);
  log(
    `precommit-tests: related (${plan.relatedPaths.length} file(s); projects: ${plan.projects.join(', ')})`,
  );
  // Positional related files must NOT follow `--` (Vitest treats them as filters that way).
  return runVitestArgv(
    ['related', '--run', '--bail', '1', '--passWithNoTests', ...projectArgs, ...plan.relatedPaths],
    opts,
  );
}

/**
 * @param {string | undefined} stagedListPath
 * @returns {string[]}
 */
export function readStagedPathsFromFile(stagedListPath) {
  if (!stagedListPath) return [];
  if (!fs.existsSync(stagedListPath)) {
    console.error(`precommit-tests: staged list not found: ${stagedListPath}`);
    process.exit(1);
  }
  return fs
    .readFileSync(stagedListPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * @returns {string[]}
 */
export function readStagedPathsFromGit() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error('precommit-tests: git diff --cached failed');
    process.exit(1);
  }
  return (result.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function main(argv = process.argv.slice(2)) {
  let stagedPaths;
  const listIdx = argv.indexOf('--staged-list');
  if (listIdx !== -1) {
    stagedPaths = readStagedPathsFromFile(argv[listIdx + 1]);
  } else if (argv[0] && !argv[0].startsWith('-')) {
    // Paths passed directly (for tests / manual runs).
    stagedPaths = argv.filter((a) => !a.startsWith('-'));
  } else {
    stagedPaths = readStagedPathsFromGit();
  }

  const code = runPrecommitTests(stagedPaths);
  process.exit(code);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
