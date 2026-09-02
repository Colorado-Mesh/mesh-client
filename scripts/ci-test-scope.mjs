#!/usr/bin/env node
/**
 * Resolve the Vitest work for a CI event.
 *
 * Pull requests reuse the staged-test planner against the true PR merge base.
 * Merge queue, main push, manual, and test-infrastructure runs fail closed to
 * the full suite so the final landing gate still enforces global coverage.
 */
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { planPrecommitTests } from './precommit-tests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PATH_OUTPUT_LENGTH = 48_000;

export const ALL_VITEST_PROJECTS = ['renderer-ui', 'renderer-logic', 'main'];

const CI_FORCE_FULL_PATTERNS = [
  /^\.github\/actions\/setup-node-pnpm\//,
  /^\.github\/workflows\/tests\.yaml$/,
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

export function planCiTests(eventName, changedPaths) {
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
  if (localPlan.mode === 'skip') {
    return { mode: 'skip', projects: [], relatedPaths: [], reason: 'no Vitest-relevant changes' };
  }

  const relatedPaths = [...localPlan.relatedPaths].sort();
  const encodedPaths = JSON.stringify(relatedPaths);
  if (encodedPaths.length > MAX_PATH_OUTPUT_LENGTH) {
    return fullPlan('related path output exceeded the safe limit');
  }

  // Shared contracts are consumed across process boundaries. The local staged
  // planner optimizes for fast feedback, while PR CI deliberately checks every
  // Vitest project when a shared file changes.
  const projects = relatedPaths.some((file) => file.startsWith('src/shared/'))
    ? [...ALL_VITEST_PROJECTS]
    : ALL_VITEST_PROJECTS.filter((project) => localPlan.projects.includes(project));

  return { mode: 'related', projects, relatedPaths, reason: 'affected tests selected' };
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

  const changed = resolvePullRequestChangedPaths({
    baseSha: env.CI_PR_BASE_SHA,
    headSha: env.CI_PR_HEAD_SHA ?? env.GITHUB_SHA,
    root: opts.root ?? ROOT,
    spawnSyncFn: opts.spawnSyncFn ?? spawnSync,
  });
  if (!changed.paths) {
    return { ...fullPlan(`safe fallback: ${changed.reason}`), mergeBase: changed.mergeBase };
  }
  return { ...planCiTests(eventName, changed.paths), mergeBase: changed.mergeBase };
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
