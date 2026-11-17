// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { commitTree, showFile, treeWithFiles } from './promotionGit.mjs';
import { openPromotion } from './promotion-open.mjs';
import { cleanupRepos, land, released, run } from './promotionTestRepos.mjs';
import { planReleaseTag, runCli } from './release-tag-plan.mjs';
import { setPackageVersion } from './releaseVersion.mjs';

const scratch = [];
afterEach(() => {
  cleanupRepos();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOTES_BODY = [
  '## Release notes',
  '',
  '### Features',
  '',
  '- feat: maps (#1)',
  '',
  '## Version',
  '',
  '1.0.0 -> 1.1.0',
].join('\n');

/** Fake GitHub API over the bare remote; `pulls` answers commits/{sha}/pulls. */
function apiFor(remote, pulls = []) {
  return {
    branchSha: async (name) => run(remote, ['rev-parse', `refs/heads/${name}`]),
    tagExists: async (tag) => {
      try {
        run(remote, ['rev-parse', '--verify', `refs/tags/${tag}`]);
        return true;
      } catch {
        return false;
      }
    },
    pullsForCommit: async () => pulls,
  };
}

/** Build a promotion with the real tooling and merge it into main the way GitHub does. */
async function mergedPromotion() {
  const fixture = released();
  land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
  const promotion = await openPromotion({
    cwd: fixture.user,
    remote: 'origin',
    bump: 'auto',
    dryRun: false,
    draft: false,
    today: '2026-11-20',
    gh: (args) => (args[1] === 'list' ? '[]' : 'https://example.test/pull/7'),
  });
  run(fixture.seed, ['fetch', '-q', 'origin']);
  run(fixture.seed, ['checkout', '-q', '-B', 'main', 'origin/main']);
  run(fixture.seed, [
    'merge',
    '-q',
    '--no-ff',
    '-m',
    `Merge pull request #7 from ${promotion.branch}`,
    `origin/${promotion.branch}`,
  ]);
  run(fixture.seed, ['push', '-q', 'origin', 'HEAD:main']);
  run(fixture.user, ['fetch', '-q', 'origin']);
  const sha = run(fixture.remote, ['rev-parse', 'refs/heads/main']);
  return { fixture, sha };
}

describe('planReleaseTag', { timeout: 60_000 }, () => {
  it('tags a merged promotion with the notes from its pull request', async () => {
    const { fixture, sha } = await mergedPromotion();
    const api = apiFor(fixture.remote, [{ number: 7, merge_commit_sha: sha, body: NOTES_BODY }]);

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan).toMatchObject({ shouldTag: true, version: '1.1.0', tag: 'v1.1.0' });
    expect(plan.notes).toBe('### Features\n\n- feat: maps (#1)');
  });

  it('falls back to notes from commit titles when no pull request matches', async () => {
    const { fixture, sha } = await mergedPromotion();
    const api = apiFor(fixture.remote, [
      { number: 3, merge_commit_sha: 'other', body: NOTES_BODY },
    ]);

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api });

    expect(plan.shouldTag).toBe(true);
    expect(plan.notes).toBe('### Features\n\n- feat: maps (#1)');
  });

  it('skips an existing tag', async () => {
    const { fixture, sha } = await mergedPromotion();
    run(fixture.remote, ['tag', 'v1.1.0', sha]);

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api: apiFor(fixture.remote) });

    expect(plan.shouldTag).toBe(false);
    expect(plan.reason).toContain('already tagged');
  });

  it('skips an ordinary push that keeps the released version', async () => {
    const fixture = released();
    land(fixture.seed, 'main', { 'docs.md': 'docs\n' }, 'docs: notes (#5)');
    run(fixture.user, ['fetch', '-q', 'origin']);
    const sha = run(fixture.remote, ['rev-parse', 'refs/heads/main']);

    const plan = await planReleaseTag({ cwd: fixture.user, sha, api: apiFor(fixture.remote) });

    expect(plan).toMatchObject({ shouldTag: false, version: '1.0.0' });
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
    const { fixture, sha } = await mergedPromotion();
    const files = outputs();
    const notesFile = path.join(files.dir, 'notes.md');

    const code = await runCli({
      argv: ['--sha', sha, '--notes-file', notesFile],
      env: { GITHUB_OUTPUT: files.output, GITHUB_STEP_SUMMARY: files.summary },
      cwd: fixture.user,
      api: apiFor(fixture.remote, [{ number: 7, merge_commit_sha: sha, body: NOTES_BODY }]),
    });

    expect(code).toBe(0);
    const output = readFileSync(files.output, 'utf8');
    const block =
      /^should_tag=true\nversion=1\.1\.0\ntag=v1\.1\.0\nnotes<<(\S+)\n([\s\S]*)\n\1\n$/.exec(
        output,
      );
    expect(block, output).not.toBeNull();
    expect(block[1]).toMatch(/^RELEASE_NOTES_[0-9a-f]{32}$/);
    expect(block[2]).toBe('### Features\n\n- feat: maps (#1)');
    expect(readFileSync(notesFile, 'utf8')).toBe('### Features\n\n- feat: maps (#1)\n');
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
