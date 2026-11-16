#!/usr/bin/env node
/**
 * Resolve the Vitest work for a CI event.
 *
 * Pull requests reuse the staged-test planner against the true PR merge base,
 * then add every Vitest test that names a changed file by its repo path: those
 * tests read the file as text (workflow YAML, copied scripts, docs), so the
 * import graph behind `vitest related` never reaches them.
 * Merge queue, main push, manual, and test-infrastructure runs fail closed to
 * the full suite so the final landing gate still enforces global coverage.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { pickProjects, planPrecommitTests } from './precommit-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PATH_OUTPUT_LENGTH = 48_000;

/** Test files the three Vitest projects in vitest.config.mts collect. */
const VITEST_TEST_PATH_RE =
  /^(?:src\/.+\.test\.tsx?|scripts\/.+\.test\.mjs|vitest\.harness\.test\.ts)$/;
/** Splits test source into runs of characters a repo path can contain. */
const PATH_TOKEN_SPLIT_RE = /[^\w./@+-]+/;

export const ALL_VITEST_PROJECTS = ['renderer-ui', 'renderer-logic', 'main'];

const CI_FORCE_FULL_PATTERNS = [
  /^\.github\/actions\/setup-node-pnpm\//,
  /^\.github\/workflows\/tests\.yaml$/,
  /^\.github\/workflows\/bundle-size\.yaml$/,
  /^scripts\/ci-(?:run-vitest|test-scope)(?:\.test)?\.mjs$/,
  /^scripts\/precommit-tests(?:\.test)?\.mjs$/,
  /^\.npmrc$/,
  /^pnpm-workspace\.yaml$/,
  /^patches\//,
];

function fullPlan(reason) {
  return {
    mode: 'full',
    projects: [...ALL_VITEST_PROJECTS],
    relatedPaths: [],
    reason,
  };
}

export function isCiForceFullPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const isRootTsconfig =
    !normalized.includes('/') &&
    (normalized === 'tsconfig.json' ||
      (normalized.startsWith('tsconfig.') && normalized.endsWith('.json')));
  return isRootTsconfig || CI_FORCE_FULL_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Strip the `./`, `../` or `/` a test puts before a repo path (`'./flake.nix'`,
 * `` `${ROOT}/docs/ci-cd.md` ``) and a sentence-ending dot after it.
 * @param {string} token
 * @returns {string}
 */
function normalizePathToken(token) {
  let start = 0;
  for (;;) {
    if (token.startsWith('../', start)) start += 3;
    else if (token.startsWith('./', start)) start += 2;
    else if (token.startsWith('/', start)) start += 1;
    else break;
  }
  let end = token.length;
  while (end > start && token[end - 1] === '.') end -= 1;
  return token.slice(start, end);
}

/**
 * Vitest tests that name a changed file by its whole repo path. A bare name with no `/` or `.`
 * (`LICENSE`, `copyright`) is not searched, since it also reads as an ordinary word. Paths a
 * test builds from segments (`path.join('scripts', name)`) are not found; the full suite on
 * protected events still covers those.
 * @param {string[]} changedPaths repo-relative, forward slashes
 * @param {Iterable<[string, string]>} testSources [test path, source text]
 * @returns {string[]} sorted test paths
 */
export function findPathReaderTests(changedPaths, testSources) {
  const changed = new Set(changedPaths.map((file) => file.replace(/\\/g, '/')));
  const searched = new Set([...changed].filter((file) => /[./]/.test(file)));
  if (searched.size === 0) return [];

  const readers = new Set();
  for (const [testPath, text] of testSources) {
    // A changed test is already selected; it is not a reader of itself.
    if (changed.has(testPath)) continue;
    for (const token of text.split(PATH_TOKEN_SPLIT_RE)) {
      if (searched.has(normalizePathToken(token))) {
        readers.add(testPath);
        break;
      }
    }
  }
  return [...readers].sort();
}

/**
 * Read every tracked Vitest test file. Returns null when git or a read fails, so the caller
 * can fail closed instead of silently selecting fewer tests.
 * @param {{ root?: string, spawnSyncFn?: typeof spawnSync, readFileFn?: typeof readFileSync }} [opts]
 * @returns {[string, string][] | null}
 */
export function readVitestTestSources({
  root = ROOT,
  spawnSyncFn = spawnSync,
  readFileFn = readFileSync,
} = {}) {
  const listing = spawnSyncFn('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (listing.status !== 0) return null;

  const output = Buffer.isBuffer(listing.stdout)
    ? listing.stdout.toString('utf8')
    : String(listing.stdout ?? '');
  const sources = [];
  for (const file of output.split('\0')) {
    if (!VITEST_TEST_PATH_RE.test(file)) continue;
    try {
      sources.push([file, readFileFn(path.join(root, file), 'utf8')]);
    } catch (error) {
      console.warn(`ci-test-scope: cannot read ${file}: ${error?.message ?? error}`);
      return null;
    }
  }
  return sources;
}

/**
 * @param {string} eventName
 * @param {string[]} changedPaths
 * @param {{ findReaderTests?: (paths: string[]) => string[] | null }} [options]
 *   Finds tests that read a changed file by path; null means the test files could not be read.
 *   Called only when the plan is not already the full suite.
 */
export function planCiTests(eventName, changedPaths, { findReaderTests } = {}) {
  if (eventName !== 'pull_request') {
    return fullPlan('protected event');
  }

  const normalizedPaths = [...new Set(changedPaths.map((file) => file.replace(/\\/g, '/')))].sort();
  if (normalizedPaths.some(isCiForceFullPath)) {
    return fullPlan('test infrastructure changed');
  }

  const localPlan = planPrecommitTests(normalizedPaths, { allowManifestOnlySkip: false });
  if (localPlan.mode === 'full') {
    return fullPlan('test infrastructure or dependency manifest changed');
  }

  const pathReaderTests = findReaderTests ? findReaderTests(normalizedPaths) : [];
  if (pathReaderTests === null) {
    return fullPlan('test file listing failed');
  }

  const localRelated = localPlan.mode === 'skip' ? [] : localPlan.relatedPaths;
  const relatedPaths = [...new Set([...localRelated, ...pathReaderTests])].sort();
  if (relatedPaths.length === 0) {
    return {
      mode: 'skip',
      projects: [],
      relatedPaths: [],
      pathReaderTests: [],
      reason: 'no Vitest-relevant changes',
    };
  }

  const encodedPaths = JSON.stringify(relatedPaths);
  if (encodedPaths.length > MAX_PATH_OUTPUT_LENGTH) {
    return fullPlan('related path output exceeded the safe limit');
  }

  // Shared contracts are consumed across process boundaries. The local staged
  // planner optimizes for fast feedback, while PR CI deliberately checks every
  // Vitest project when a shared file changes. Each path reader adds its own project,
  // or that project's shard would never run it.
  const localProjects = localPlan.mode === 'skip' ? [] : localPlan.projects;
  const readerProjects = pathReaderTests.length > 0 ? pickProjects(pathReaderTests) : [];
  const projects = relatedPaths.some((file) => file.startsWith('src/shared/'))
    ? [...ALL_VITEST_PROJECTS]
    : ALL_VITEST_PROJECTS.filter(
        (project) => localProjects.includes(project) || readerProjects.includes(project),
      );

  return {
    mode: 'related',
    projects,
    relatedPaths,
    pathReaderTests,
    reason: 'affected tests selected',
  };
}

export function resolvePullRequestChangedPaths({
  baseSha,
  headSha,
  root = ROOT,
  spawnSyncFn = spawnSync,
}) {
  if (!baseSha || !headSha) {
    return { paths: null, mergeBase: '', reason: 'pull request base/head SHA missing' };
  }

  const mergeBaseResult = spawnSyncFn('git', ['merge-base', baseSha, headSha], {
    cwd: root,
    encoding: 'utf8',
  });
  const mergeBase = String(mergeBaseResult.stdout ?? '').trim();
  if (mergeBaseResult.status !== 0 || !mergeBase) {
    return { paths: null, mergeBase: '', reason: 'git merge-base failed' };
  }

  // `vitest related` cannot traverse the import graph of a file that no longer
  // exists. Renames are intentionally represented as delete+add, so both cases
  // fail closed to the full suite.
  const deletionResult = spawnSyncFn(
    'git',
    ['diff', '--no-renames', '--diff-filter=D', '--quiet', mergeBase, headSha],
    { cwd: root },
  );
  if (deletionResult.status === 1) {
    return { paths: null, mergeBase, reason: 'deleted or renamed paths require the full suite' };
  }
  if (deletionResult.status !== 0) {
    return { paths: null, mergeBase, reason: 'git deletion check failed' };
  }

  const diffResult = spawnSyncFn(
    'git',
    ['diff', '--no-renames', '--name-only', '-z', mergeBase, headSha],
    { cwd: root, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 },
  );
  if (diffResult.status !== 0) {
    return { paths: null, mergeBase, reason: 'git diff failed' };
  }

  const output = Buffer.isBuffer(diffResult.stdout)
    ? diffResult.stdout.toString('utf8')
    : String(diffResult.stdout ?? '');
  const paths = output
    .split('\0')
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, '/'));
  return { paths, mergeBase, reason: '' };
}

export function resolveCiTestPlanFromEnvironment(env = process.env, opts = {}) {
  const eventName = env.GITHUB_EVENT_NAME ?? '';
  if (eventName !== 'pull_request') {
    return { ...fullPlan('protected event'), mergeBase: '' };
  }

  const root = opts.root ?? ROOT;
  const spawnSyncFn = opts.spawnSyncFn ?? spawnSync;
  const changed = resolvePullRequestChangedPaths({
    baseSha: env.CI_PR_BASE_SHA,
    headSha: env.CI_PR_HEAD_SHA ?? env.GITHUB_SHA,
    root,
    spawnSyncFn,
  });
  if (!changed.paths) {
    return { ...fullPlan(`safe fallback: ${changed.reason}`), mergeBase: changed.mergeBase };
  }
  const findReaderTests = (paths) => {
    const sources = readVitestTestSources({ root, spawnSyncFn, readFileFn: opts.readFileFn });
    return sources ? findPathReaderTests(paths, sources) : null;
  };
  return {
    ...planCiTests(eventName, changed.paths, { findReaderTests }),
    mergeBase: changed.mergeBase,
  };
}

export function formatGitHubOutputs(plan) {
  return [
    `vitest_mode=${plan.mode}`,
    `vitest_projects=${JSON.stringify(plan.projects)}`,
    `vitest_paths=${JSON.stringify(plan.relatedPaths)}`,
    `vitest_merge_base=${plan.mergeBase ?? ''}`,
  ].join('\n');
}

function main() {
  const plan = resolveCiTestPlanFromEnvironment();
  const outputs = `${formatGitHubOutputs(plan)}\n`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  } else {
    process.stdout.write(outputs);
  }

  const summary = [
    '## Vitest scope',
    '',
    `- Mode: \`${plan.mode}\``,
    `- Projects: ${plan.projects.length > 0 ? plan.projects.join(', ') : 'none'}`,
    `- Related paths: ${plan.relatedPaths.length}`,
    `- Tests that read a changed file by path: ${plan.pathReaderTests?.length ?? 0}`,
    `- Reason: ${plan.reason}`,
  ].join('\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } else {
    console.error(summary);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
