// @vitest-environment node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  ALL_VITEST_PROJECTS,
  findPathReaderTests,
  formatGitHubOutputs,
  planCiTests,
  readVitestTestSources,
  resolveCiTestPlanFromEnvironment,
  resolvePullRequestChangedPaths,
} from './ci-test-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('ci-test-scope planning', () => {
  it('skips Vitest for documentation-only pull requests', () => {
    expect(planCiTests('pull_request', ['README.md', 'docs/ci-cd.md'])).toMatchObject({
      mode: 'skip',
      projects: [],
      relatedPaths: [],
    });
  });

  it('runs the sidecar route/doc guard for an IPC-doc-only pull request', () => {
    expect(
      planCiTests('pull_request', ['docs/reticulum-sidecar-ipc.md', 'README.md']),
    ).toMatchObject({
      mode: 'related',
      projects: ['main'],
      relatedPaths: ['src/architecture/sidecarRouteDocs.test.ts'],
    });
  });

  it('runs the sidecar route/doc guard when sidecar routes change', () => {
    const plan = planCiTests('pull_request', ['reticulum-sidecar/src/api/mod.rs']);
    expect(plan.mode).toBe('related');
    expect(plan.relatedPaths).toContain('src/architecture/sidecarRouteDocs.test.ts');
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
    '.github/workflows/bundle-size.yaml',
    '.github/actions/setup-node-pnpm/action.yaml',
    'scripts/ci-test-scope.mjs',
    'scripts/precommit-tests.test.mjs',
    '.npmrc',
    'package.json',
    'patches/debug@4.4.3.patch',
    'pnpm-lock.yaml',
    'org.coloradomesh.MeshClient.yml',
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

describe('ci-test-scope path-reader tests', () => {
  const sources = [
    [
      'scripts/bundle-size-workflow.test.mjs',
      "fs.copyFileSync(path.join(ROOT, 'scripts/example-build.mjs'), target);",
    ],
    ['scripts/release-notes.test.mjs', 'const notes = readFileSync(`${ROOT}/docs/ci-cd.md`);'],
    ['scripts/relative-reader.test.mjs', "readFileSync('./flake.nix', 'utf8');"],
    ['scripts/comment-reader.test.mjs', '// The fixture mirrors docs/ops-guide.md.'],
    [
      'scripts/url-reader.test.mjs',
      "readFileSync(new URL('../example-site.yml', import.meta.url));",
    ],
    ['scripts/docs-readme.test.mjs', "readFileSync('docs/README.md', 'utf8');"],
    ['scripts/legal.test.mjs', "expect(text).toContain('LICENSE');"],
    ['src/renderer/lib/exampleTsx.test.ts', "readFileSync('src/main/example.tsx', 'utf8');"],
  ];

  it('finds tests that name a changed file by its repo path', () => {
    expect(
      findPathReaderTests(
        [
          'scripts/example-build.mjs',
          'docs/ci-cd.md',
          'flake.nix',
          'docs/ops-guide.md',
          'example-site.yml',
        ],
        sources,
      ),
    ).toEqual([
      'scripts/bundle-size-workflow.test.mjs',
      'scripts/comment-reader.test.mjs',
      'scripts/relative-reader.test.mjs',
      'scripts/release-notes.test.mjs',
      'scripts/url-reader.test.mjs',
    ]);
  });

  it('matches whole paths only, not a suffix of a longer path or a longer name', () => {
    expect(findPathReaderTests(['README.md', 'src/main/example.ts'], sources)).toEqual([]);
  });

  it('does not search for bare names that read as ordinary words', () => {
    expect(findPathReaderTests(['LICENSE'], sources)).toEqual([]);
  });

  it('does not list a changed test file as a reader of itself', () => {
    expect(
      findPathReaderTests(
        ['scripts/self.test.mjs'],
        [['scripts/self.test.mjs', "const SELF = 'scripts/self.test.mjs';"]],
      ),
    ).toEqual([]);
  });

  it('adds reader tests and their project to a related plan', () => {
    const plan = planCiTests('pull_request', ['src/main/exampleScheduler.ts'], {
      findReaderTests: () => ['scripts/bundle-size-workflow.test.mjs'],
    });
    expect(plan.mode).toBe('related');
    expect(plan.projects).toEqual(['main']);
    expect(plan.relatedPaths).toContain('src/main/exampleScheduler.ts');
    expect(plan.relatedPaths).toContain('scripts/bundle-size-workflow.test.mjs');
    expect(plan.pathReaderTests).toEqual(['scripts/bundle-size-workflow.test.mjs']);
  });

  it('turns an otherwise skipped pull request into a related run of its readers', () => {
    expect(
      planCiTests('pull_request', ['docs/example-licenses.md'], {
        findReaderTests: () => ['scripts/privileged-workflow-boundary.test.mjs'],
      }),
    ).toMatchObject({
      mode: 'related',
      projects: ['main'],
      relatedPaths: ['scripts/privileged-workflow-boundary.test.mjs'],
    });
  });

  it('still skips a docs-only pull request when no test names its files', () => {
    expect(
      planCiTests('pull_request', ['docs/ci-cd.md'], { findReaderTests: () => [] }),
    ).toMatchObject({ mode: 'skip', projects: [], relatedPaths: [] });
  });

  it('adds the main project when a renderer-only change has a script reader', () => {
    const locale = 'src/renderer/locales/en/translation.json';
    expect(planCiTests('pull_request', [locale]).projects).not.toContain('main');
    const plan = planCiTests('pull_request', [locale], {
      findReaderTests: () => ['scripts/i18n-auto-translate.test.mjs'],
    });
    expect(plan.projects).toEqual(ALL_VITEST_PROJECTS);
    expect(plan.relatedPaths).toContain('scripts/i18n-auto-translate.test.mjs');
  });

  it('fails closed to the full suite when the test files cannot be read', () => {
    expect(
      planCiTests('pull_request', ['src/main/database.ts'], { findReaderTests: () => null }),
    ).toMatchObject({
      mode: 'full',
      projects: ALL_VITEST_PROJECTS,
      reason: 'test file listing failed',
    });
  });

  it('fails closed to the full suite when reader paths overflow the output limit', () => {
    const readers = Array.from(
      { length: 2_000 },
      (_, i) => `scripts/a-long-generated-reader-name-${String(i).padStart(4, '0')}.test.mjs`,
    );
    expect(
      planCiTests('pull_request', ['src/main/database.ts'], { findReaderTests: () => readers }),
    ).toMatchObject({ mode: 'full', reason: 'related path output exceeded the safe limit' });
  });

  it('does not look for readers when the plan is already the full suite', () => {
    const findReaderTests = vi.fn(() => []);
    planCiTests('pull_request', ['package.json'], { findReaderTests });
    planCiTests('push', ['src/main/database.ts'], { findReaderTests });
    expect(findReaderTests).not.toHaveBeenCalled();
  });

  it('lists Vitest test files with git and reads each one', () => {
    const spawnSyncFn = vi.fn(() => ({
      status: 0,
      stdout: Buffer.from(
        'scripts/a.test.mjs\0src/main/b.test.ts\0e2e/c.spec.ts\0scripts/d.mjs\0vitest.harness.test.ts\0',
      ),
    }));
    const readFileFn = vi.fn((file) => `text of ${path.basename(file)}`);
    expect(readVitestTestSources({ root: '/repo', spawnSyncFn, readFileFn })).toEqual([
      ['scripts/a.test.mjs', 'text of a.test.mjs'],
      ['src/main/b.test.ts', 'text of b.test.ts'],
      ['vitest.harness.test.ts', 'text of vitest.harness.test.ts'],
    ]);
    expect(spawnSyncFn).toHaveBeenCalledWith(
      'git',
      ['ls-files', '-z'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('returns null when git cannot list the test files', () => {
    const spawnSyncFn = vi.fn(() => ({ status: 128, stdout: Buffer.from('') }));
    expect(readVitestTestSources({ root: '/repo', spawnSyncFn })).toBeNull();
  });

  it('returns null when a listed test file cannot be read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spawnSyncFn = vi.fn(() => ({ status: 0, stdout: Buffer.from('scripts/a.test.mjs\0') }));
    const readFileFn = vi.fn(() => {
      throw new Error('EACCES');
    });
    expect(readVitestTestSources({ root: '/repo', spawnSyncFn, readFileFn })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('scripts/a.test.mjs: EACCES'));
    warn.mockRestore();
  });

  // The #1461 regression: the bundle workflow test copies the esbuild main-build script by path,
  // so Vitest's import graph never reaches it from a change to that script.
  it('selects the bundle workflow test for an esbuild main-build change in this repository', () => {
    const sources = readVitestTestSources({ root: ROOT });
    expect(sources).not.toBeNull();
    expect(findPathReaderTests(['scripts/esbuild-main-build.mjs'], sources)).toContain(
      'scripts/bundle-size-workflow.test.mjs',
    );
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

  it('adds path readers found in the pull request head to the plan', () => {
    const spawnSyncFn = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: 'merge-base\n' })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0, stdout: Buffer.from('docs/example-licenses.md\0') })
      .mockReturnValueOnce({
        status: 0,
        stdout: Buffer.from(
          'scripts/privileged-workflow-boundary.test.mjs\0scripts/unrelated.test.mjs\0',
        ),
      });
    const readFileFn = vi.fn((file) =>
      file.endsWith('privileged-workflow-boundary.test.mjs')
        ? "const DOC = 'docs/example-licenses.md';"
        : "const DOC = 'docs/ci-cd.md';",
    );
    const plan = resolveCiTestPlanFromEnvironment(
      { GITHUB_EVENT_NAME: 'pull_request', CI_PR_BASE_SHA: 'base', CI_PR_HEAD_SHA: 'head' },
      { root: '/repo', spawnSyncFn, readFileFn },
    );
    expect(plan).toMatchObject({
      mode: 'related',
      projects: ['main'],
      relatedPaths: ['scripts/privileged-workflow-boundary.test.mjs'],
      mergeBase: 'merge-base',
    });
    expect(spawnSyncFn).toHaveBeenNthCalledWith(
      4,
      'git',
      ['ls-files', '-z'],
      expect.objectContaining({ cwd: '/repo' }),
    );
  });

  it('fails closed when the pull request test files cannot be listed', () => {
    const spawnSyncFn = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: 'merge-base\n' })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0, stdout: Buffer.from('src/main/database.ts\0') })
      .mockReturnValueOnce({ status: 128, stdout: Buffer.from('') });
    const plan = resolveCiTestPlanFromEnvironment(
      { GITHUB_EVENT_NAME: 'pull_request', CI_PR_BASE_SHA: 'base', CI_PR_HEAD_SHA: 'head' },
      { root: '/repo', spawnSyncFn },
    );
    expect(plan).toMatchObject({
      mode: 'full',
      projects: ALL_VITEST_PROJECTS,
      reason: 'test file listing failed',
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
