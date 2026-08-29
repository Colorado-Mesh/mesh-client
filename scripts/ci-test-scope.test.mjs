// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  ALL_VITEST_PROJECTS,
  formatGitHubOutputs,
  planCiTests,
  resolveCiTestPlanFromEnvironment,
  resolvePullRequestChangedPaths,
} from './ci-test-scope.mjs';

describe('ci-test-scope planning', () => {
  it('skips Vitest for documentation-only pull requests', () => {
    expect(planCiTests('pull_request', ['README.md', 'docs/ci-cd.md'])).toMatchObject({
      mode: 'skip',
      projects: [],
      relatedPaths: [],
    });
  });

  it.each(['push', 'merge_group', 'workflow_dispatch'])(
    'runs the full suite for protected %s events',
    (eventName) => {
      expect(planCiTests(eventName, ['docs/ci-cd.md'])).toMatchObject({
        mode: 'full',
        projects: ALL_VITEST_PROJECTS,
      });
    },
  );

  it('selects related main-process tests', () => {
    const plan = planCiTests('pull_request', ['src/main/database.ts']);
    expect(plan.mode).toBe('related');
    expect(plan.projects).toEqual(['main']);
    expect(plan.relatedPaths).toContain('src/main/database.ts');
    expect(plan.relatedPaths).toContain('src/architecture/sourcePolicy.test.ts');
  });

  it('selects renderer and source-policy projects for renderer changes', () => {
    const plan = planCiTests('pull_request', ['src/renderer/components/ChatPanel.tsx']);
    expect(plan.mode).toBe('related');
    expect(plan.projects).toEqual(ALL_VITEST_PROJECTS);
  });

  it('runs every project for shared contract changes', () => {
    const plan = planCiTests('pull_request', ['src/shared/electron-api.types.ts']);
    expect(plan.mode).toBe('related');
    expect(plan.projects).toEqual(ALL_VITEST_PROJECTS);
  });

  it.each([
    '.github/workflows/tests.yaml',
    '.github/actions/setup-node-pnpm/action.yaml',
    'scripts/ci-test-scope.mjs',
    'scripts/precommit-tests.test.mjs',
    '.npmrc',
    'package.json',
    'patches/debug@4.4.3.patch',
    'pnpm-lock.yaml',
    'tsconfig.main.json',
    'vitest.config.mts',
  ])('fails closed to the full suite when %s changes', (filePath) => {
    expect(planCiTests('pull_request', [filePath])).toMatchObject({
      mode: 'full',
      projects: ALL_VITEST_PROJECTS,
    });
  });

  it('formats stable GitHub Actions outputs', () => {
    const output = formatGitHubOutputs({
      mode: 'related',
      projects: ['main'],
      relatedPaths: ['src/main/database.ts'],
      mergeBase: 'abc123',
    });
    expect(output).toContain('vitest_mode=related');
    expect(output).toContain('vitest_projects=["main"]');
    expect(output).toContain('vitest_paths=["src/main/database.ts"]');
    expect(output).toContain('vitest_merge_base=abc123');
  });
});

describe('ci-test-scope git resolution', () => {
  it('diffs the pull request merge base with NUL-delimited paths', () => {
    const spawnSyncFn = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: 'merge-base\n' })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from('src/main/a file.ts\0docs/ci-cd.md\0'),
      });

    expect(
      resolvePullRequestChangedPaths({
        baseSha: 'base',
        headSha: 'head',
        root: '/repo',
        spawnSyncFn,
      }),
    ).toEqual({
      paths: ['src/main/a file.ts', 'docs/ci-cd.md'],
      mergeBase: 'merge-base',
      reason: '',
    });
    expect(spawnSyncFn).toHaveBeenNthCalledWith(
      3,
      'git',
      ['diff', '--no-renames', '--name-only', '-z', 'merge-base', 'head'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('fails closed when change detection fails', () => {
    const spawnSyncFn = vi.fn(() => ({ status: 1, stdout: '' }));
    const plan = resolveCiTestPlanFromEnvironment(
      {
        GITHUB_EVENT_NAME: 'pull_request',
        CI_PR_BASE_SHA: 'base',
        CI_PR_HEAD_SHA: 'head',
      },
      { spawnSyncFn },
    );
    expect(plan).toMatchObject({
      mode: 'full',
      projects: ALL_VITEST_PROJECTS,
      reason: 'safe fallback: git merge-base failed',
    });
  });

  it('runs the full suite when a pull request deletes or renames a path', () => {
    const spawnSyncFn = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: 'merge-base\n' })
      .mockReturnValueOnce({ status: 1 });
    const plan = resolveCiTestPlanFromEnvironment(
      {
        GITHUB_EVENT_NAME: 'pull_request',
        CI_PR_BASE_SHA: 'base',
        CI_PR_HEAD_SHA: 'head',
      },
      { spawnSyncFn },
    );
    expect(plan).toMatchObject({
      mode: 'full',
      projects: ALL_VITEST_PROJECTS,
      reason: 'safe fallback: deleted or renamed paths require the full suite',
    });
  });
});
