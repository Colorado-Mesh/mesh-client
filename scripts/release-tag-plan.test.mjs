// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openRelease } from './release-open.mjs';
import { planReleaseTag, runCli } from './release-tag-plan.mjs';
import { commitTree, showFile, treeWithFiles } from './releaseGit.mjs';
import {
  cleanupRepos,
  FIXTURE_METAINFO as METAINFO,
  land,
  released,
  run,
} from './releaseTestRepos.mjs';
import { setPackageVersion } from './releaseVersion.mjs';

const scratch = [];
afterEach(() => {
  cleanupRepos();
  vi.restoreAllMocks();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOTES_BODY = [
  '## Release notes',
  '',
  '### Features',
  '',
  '- feat: maps (edited by hand) (#1)',
  '',
  '## Version',
  '',
  '1.0.0 -> 1.1.0',
].join('\n');

const GATE_NAMES = [
  'Electron E2E (ubuntu-24.04)',
  'Electron E2E (macos-latest)',
  'Electron E2E (windows-latest)',
  'Release preflight',
];

/** Check suite ids: GitHub Actions makes one per workflow run. */
const E2E_SUITE = 1;
const OTHER_SUITE = 2;

/**
 * Check runs as e2e.yaml reports them on a commit where every gate passed. GitHub numbers check
 * runs in order, so a run made later (E2E started on main by hand) gets a larger `firstId`.
 */
const passedOn = (sha, firstId = 1, suite = E2E_SUITE) =>
  GATE_NAMES.map((name, index) => ({
    id: firstId + index,
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    app: { id: 15368 },
    check_suite: { id: suite },
  }));

/** The same gates as a merge group reports them: skipped, under the unexpanded matrix name. */
const skippedOn = (sha) =>
  ['Electron E2E (${{ matrix.os }})', 'Release preflight', 'Release gates'].map((name, index) => ({
    id: 100 + index,
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: name === 'Release gates' ? 'success' : 'skipped',
    app: { id: 15368 },
    check_suite: { id: E2E_SUITE },
  }));

/**
 * Fake GitHub API over the bare remote: trees come from the remote, `pulls` answers
 * commits/{sha}/pulls, `checks` maps a commit to its check runs, and check suite 2 belongs to a
 * workflow other than e2e.yaml.
 */
function apiFor(remote, { pulls = [], checks = {} } = {}) {
  const suites = {
    [E2E_SUITE]: '.github/workflows/e2e.yaml',
    [OTHER_SUITE]: '.github/workflows/other.yaml',
  };
  return {
    workflowPathForCheckSuite: async (id) => suites[id] ?? null,
    tagExists: async (tag) => {
      try {
        run(remote, ['rev-parse', '--verify', `refs/tags/${tag}`]);
        return true;
      } catch {
        return false;
      }
    },
    pullsForCommit: async () => pulls,
    commitTreeSha: async (sha) => run(remote, ['rev-parse', `${sha}^{tree}`]),
    listCheckRuns: async (sha) => checks[sha] ?? [],
  };
}

/** Open a release pull request with the real tooling; returns its head commit. */
async function openedRelease(fixture) {
  land(fixture.seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
  const result = await openRelease({
    cwd: fixture.user,
    remote: 'origin',
    bump: 'auto',
    dryRun: false,
    draft: false,
    today: '2026-11-20',
    gh: (args) => (args[1] === 'list' ? '[]' : 'https://example.test/pull/7'),
  });
  return run(fixture.remote, ['rev-parse', `refs/heads/${result.branch}`]);
}

/** Land a release pull request on main the way the squash merge queue does. */
function squashRelease(fixture, head) {
  const files = Object.fromEntries(
    ['package.json', METAINFO].map((file) => [
      file,
      `${run(fixture.remote, ['show', `${head}:${file}`])}\n`,
    ]),
  );
  const sha = land(fixture.seed, files, 'chore: release v1.1.0 (#7)');
  run(fixture.user, ['fetch', '-q', 'origin']);
  return sha;
}

/** A merged release pull request: its head, the commit on main, and the API that maps them. */
async function mergedRelease({ moveMainFirst = false } = {}) {
  const fixture = released();
  const head = await openedRelease(fixture);
  if (moveMainFirst) land(fixture.seed, { 'late.txt': 'late\n' }, 'fix: landed late (#8)');
  const sha = squashRelease(fixture, head);
  const pull = {
    number: 7,
    title: 'chore: release v1.1.0',
    merge_commit_sha: sha,
    body: NOTES_BODY,
    head: { sha: head },
  };
  return { fixture, head, sha, pull };
}

/**
 * An ordinary pull request merged after the release, before anything tagged it. Its head was up
 * to date with main, so it holds the same tree as the squash commit (and, like every pull request
 * that is not a release, reports no gate runs).
 */
function laterMerge(fixture) {
  const sha = land(fixture.seed, { 'later.txt': 'later\n' }, 'feat: later (#9)');
  const head = run(fixture.seed, [
    'commit-tree',
    `${sha}^{tree}`,
    '-p',
    `${sha}~1`,
    '-m',
    'feat: later',
  ]);
  run(fixture.seed, ['push', '-q', 'origin', `${head}:refs/heads/feature/later`]);
  run(fixture.user, ['fetch', '-q', 'origin']);
  const pull = {
    number: 9,
    title: 'feat: later',
    merge_commit_sha: sha,
    body: '## Release notes\n\nThis pull request carries its own section.',
    head: { sha: head },
  };
  return { sha, pull };
}

describe('planReleaseTag', { timeout: 60_000 }, () => {
  it('tags a merged release pull request with the notes from its body', async () => {
    const { fixture, head, sha, pull } = await mergedRelease();
    const api = apiFor(fixture.remote, {
      pulls: [pull],
      checks: { [sha]: skippedOn(sha), [head]: passedOn(head) },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan).toMatchObject({
      shouldTag: true,
      blocked: false,
      version: '1.1.0',
      tag: 'v1.1.0',
    });
    expect(plan.notes).toBe('### Features\n\n- feat: maps (edited by hand) (#1)');
  });

  it('blocks when main moved between the gates and the merge', async () => {
    const { fixture, head, sha, pull } = await mergedRelease({ moveMainFirst: true });
    const api = apiFor(fixture.remote, {
      pulls: [pull],
      checks: { [sha]: skippedOn(sha), [head]: passedOn(head) },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan).toMatchObject({ shouldTag: false, blocked: true, version: '1.1.0' });
    expect(plan.reason).toContain('Electron E2E on Linux (no run)');
    expect(plan.reason).toContain('Release preflight (no run)');
  });

  it('tags once the gates have passed on the merged commit itself', async () => {
    const { fixture, head, sha, pull } = await mergedRelease({ moveMainFirst: true });
    const api = apiFor(fixture.remote, {
      pulls: [pull],
      checks: { [sha]: [...skippedOn(sha), ...passedOn(sha, 200)], [head]: passedOn(head) },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan).toMatchObject({ shouldTag: true, blocked: false, tag: 'v1.1.0' });
  });

  it('blocks on a failed gate on the pull request head', async () => {
    const { fixture, head, sha, pull } = await mergedRelease();
    const failed = passedOn(head).map((check) =>
      check.name === 'Release preflight' ? { ...check, conclusion: 'failure' } : check,
    );
    const api = apiFor(fixture.remote, {
      pulls: [pull],
      checks: { [sha]: skippedOn(sha), [head]: failed },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan).toMatchObject({ shouldTag: false, blocked: true });
    expect(plan.reason).toContain('Release preflight (failure)');
  });

  it('ignores gate-named check runs that another workflow made', async () => {
    const { fixture, head, sha, pull } = await mergedRelease();
    const api = apiFor(fixture.remote, {
      pulls: [pull],
      checks: { [sha]: skippedOn(sha), [head]: passedOn(head, 1, OTHER_SUITE) },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan).toMatchObject({ shouldTag: false, blocked: true });
    expect(plan.reason).toContain('Release preflight (no run)');
  });

  it('blocks a later push while the release is untagged and its gates have not passed', async () => {
    const { fixture } = await mergedRelease({ moveMainFirst: true });
    const later = laterMerge(fixture);
    const api = apiFor(fixture.remote, {
      pulls: [later.pull],
      checks: { [later.sha]: skippedOn(later.sha) },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha: later.sha, api });

    expect(plan).toMatchObject({ shouldTag: false, blocked: true, tag: 'v1.1.0' });
  });

  it('tags a later commit once E2E passed on it, with notes from commit titles', async () => {
    const { fixture } = await mergedRelease({ moveMainFirst: true });
    const later = laterMerge(fixture);
    const api = apiFor(fixture.remote, {
      pulls: [later.pull],
      checks: { [later.sha]: [...skippedOn(later.sha), ...passedOn(later.sha, 200)] },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha: later.sha, api });

    expect(plan).toMatchObject({ shouldTag: true, tag: 'v1.1.0' });
    expect(plan.notes).toBe(
      [
        '### Features',
        '',
        '- feat: later (#9)',
        '- feat: maps (#1)',
        '',
        '### Fixes',
        '',
        '- fix: landed late (#8)',
      ].join('\n'),
    );
  });

  it('falls back to notes from commit titles when no pull request matches', async () => {
    const { fixture, sha } = await mergedRelease();
    const api = apiFor(fixture.remote, {
      pulls: [{ number: 3, merge_commit_sha: 'other', body: NOTES_BODY, head: { sha: 'other' } }],
      checks: { [sha]: passedOn(sha) },
    });

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan.shouldTag).toBe(true);
    expect(plan.notes).toBe('### Features\n\n- feat: maps (#1)');
  });

  it('skips an existing tag without reading the gates', async () => {
    const { fixture, sha } = await mergedRelease();
    run(fixture.remote, ['tag', 'v1.1.0', sha]);

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api: apiFor(fixture.remote) });

    expect(plan).toMatchObject({ shouldTag: false, blocked: false });
    expect(plan.reason).toContain('already tagged');
  });

  it('skips an ordinary push that keeps the released version', async () => {
    const fixture = released();
    land(fixture.seed, { 'docs.md': 'docs\n' }, 'docs: notes (#5)');
    run(fixture.user, ['fetch', '-q', 'origin']);
    const sha = run(fixture.remote, ['rev-parse', 'refs/heads/main']);

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api: apiFor(fixture.remote) });

    expect(plan).toMatchObject({ shouldTag: false, blocked: false, version: '1.0.0' });
    expect(plan.reason).toContain('version unchanged');
  });

  it('refuses when MetaInfo disagrees with package.json', async () => {
    const fixture = released();
    run(fixture.user, ['fetch', '-q', 'origin']);
    const main = run(fixture.user, ['rev-parse', 'origin/main']);
    const packageText = setPackageVersion(showFile(fixture.user, main, 'package.json'), '1.1.0');
    const bumped = commitTree(fixture.user, {
      tree: treeWithFiles(fixture.user, main, { 'package.json': packageText }),
      parents: [main],
      message: 'chore: release v1.1.0',
    });
    run(fixture.user, ['push', '-q', 'origin', `${bumped}:refs/heads/main`]);

    const plan = await planReleaseTag({
      cwd: fixture.user,
      sha: bumped,
      api: apiFor(fixture.remote),
    });

    expect(plan.shouldTag).toBe(false);
    expect(plan.reason).toContain('1.0.0');
    expect(plan.reason).toContain('1.1.0');
  });
});

describe('runCli', { timeout: 60_000 }, () => {
  function outputs() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-release-plan-'));
    scratch.push(dir);
    const output = path.join(dir, 'output');
    const summary = path.join(dir, 'summary');
    writeFileSync(output, '');
    writeFileSync(summary, '');
    return { dir, output, summary };
  }

  it('writes the decision to GITHUB_OUTPUT and the notes file', async () => {
    const { fixture, head, sha, pull } = await mergedRelease();
    const files = outputs();
    const notesFile = path.join(files.dir, 'notes.md');

    const code = await runCli({
      argv: ['--sha', sha, '--notes-file', notesFile],
      env: { GITHUB_OUTPUT: files.output, GITHUB_STEP_SUMMARY: files.summary },
      cwd: fixture.user,
      api: apiFor(fixture.remote, { pulls: [pull], checks: { [head]: passedOn(head) } }),
    });

    expect(code).toBe(0);
    const output = readFileSync(files.output, 'utf8');
    const block =
      /^should_tag=true\nversion=1\.1\.0\ntag=v1\.1\.0\nnotes<<(\S+)\n([\s\S]*)\n\1\n$/.exec(
        output,
      );
    expect(block, output).not.toBeNull();
    expect(block[1]).toMatch(/^RELEASE_NOTES_[0-9a-f]{32}$/);
    expect(block[2]).toBe('### Features\n\n- feat: maps (edited by hand) (#1)');
    expect(readFileSync(notesFile, 'utf8')).toBe(
      '### Features\n\n- feat: maps (edited by hand) (#1)\n',
    );
    expect(readFileSync(files.summary, 'utf8')).toContain('v1.1.0');
  });

  it('exits 1 with --require-tag when nothing should be tagged', async () => {
    const fixture = released();
    run(fixture.user, ['fetch', '-q', 'origin']);
    const sha = run(fixture.remote, ['rev-parse', 'refs/heads/main']);
    const files = outputs();

    const code = await runCli({
      argv: ['--sha', sha, '--require-tag'],
      env: { GITHUB_OUTPUT: files.output },
      cwd: fixture.user,
      api: apiFor(fixture.remote),
    });

    expect(code).toBe(1);
    expect(readFileSync(files.output, 'utf8')).toContain('should_tag=false');
  });

  it('exits 1 and says how to recover when the gates have not passed', async () => {
    const { fixture, head, sha, pull } = await mergedRelease({ moveMainFirst: true });
    const files = outputs();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const code = await runCli({
      argv: ['--sha', sha],
      env: { GITHUB_OUTPUT: files.output, GITHUB_STEP_SUMMARY: files.summary },
      cwd: fixture.user,
      api: apiFor(fixture.remote, { pulls: [pull], checks: { [head]: passedOn(head) } }),
    });

    expect(code).toBe(1);
    expect(readFileSync(files.output, 'utf8')).toBe(
      'should_tag=false\nversion=1.1.0\ntag=v1.1.0\n',
    );
    const printed = errors.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).toContain('Electron E2E on Linux (no run)');
    expect(printed).toContain('Run the E2E workflow on main');
    expect(printed).toContain('run Cut release on main');
    expect(readFileSync(files.summary, 'utf8')).toContain('Blocked');
  });
});

describe('annotated tag message', () => {
  it('keeps markdown headings in the tag message', () => {
    const fixture = released();
    const notes = path.join(fixture.user, '..', 'notes.md');
    writeFileSync(notes, '### Features\n\n- feat: maps (#1)\n');
    run(fixture.user, ['tag', '-a', 'v9.9.9', '--cleanup=verbatim', '-F', notes, 'HEAD']);
    run(fixture.user, ['tag', '-a', 'v9.9.8', '-F', notes, 'HEAD']);

    expect(run(fixture.user, ['cat-file', 'tag', 'v9.9.9'])).toContain('### Features');
    // Git's default cleanup treats "#" lines as comments, which is why the workflow passes
    // --cleanup=verbatim.
    expect(run(fixture.user, ['cat-file', 'tag', 'v9.9.8'])).not.toContain('### Features');
  });
});
