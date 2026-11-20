// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authEnv,
  changedPaths,
  commitPathsInRange,
  commitsInRange,
  commitTree,
  fetchRefs,
  isAncestor,
  latestReleaseTag,
  revParse,
  showFile,
  treeOf,
  treeWithFiles,
} from './releaseGit.mjs';

const dirs = [];

function run(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `mesh-release-${prefix}-`));
  dirs.push(dir);
  return dir;
}

function newRepo() {
  const repo = tempDir('git');
  run(repo, ['init', '-q', '-b', 'main']);
  run(repo, ['config', 'user.name', 'test']);
  run(repo, ['config', 'user.email', 'test@example.com']);
  run(repo, ['config', 'commit.gpgsign', 'false']);
  run(repo, ['config', 'tag.gpgsign', 'false']);
  return repo;
}

function commitFiles(repo, files, message) {
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(path.join(repo, file), content);
  }
  run(repo, ['add', '-A']);
  run(repo, ['commit', '-q', '-m', message]);
  return run(repo, ['rev-parse', 'HEAD']);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('treeWithFiles and commitTree', () => {
  it('builds a commit with replaced files and the given parents without touching the checkout', () => {
    const repo = newRepo();
    const base = commitFiles(
      repo,
      { 'package.json': '{"version":"1.0.0"}\n', 'tool.sh': '#!/bin/sh\n' },
      'base',
    );
    chmodSync(path.join(repo, 'tool.sh'), 0o755);
    run(repo, ['add', 'tool.sh']);
    run(repo, ['commit', '-q', '-m', 'make tool executable']);
    const head = run(repo, ['rev-parse', 'HEAD']);

    const tree = treeWithFiles(repo, head, {
      'package.json': '{"version":"1.1.0"}\n',
      'tool.sh': '#!/bin/sh\necho replaced\n',
    });
    const sha = commitTree(repo, {
      tree,
      parents: [head, base],
      message: 'chore: release v1.1.0\n',
    });

    expect(run(repo, ['show', `${sha}:package.json`])).toBe('{"version":"1.1.0"}');
    expect(run(repo, ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1)).toEqual([
      head,
      base,
    ]);
    expect(run(repo, ['log', '-1', '--format=%s', sha])).toBe('chore: release v1.1.0');
    expect(run(repo, ['ls-tree', sha, '--', 'tool.sh']).split(/\s+/)[0]).toBe('100755');
    expect(run(repo, ['show', `${sha}:tool.sh`])).toBe('#!/bin/sh\necho replaced');
    expect(run(repo, ['status', '--porcelain'])).toBe('');
    expect(revParse(repo, 'HEAD')).toBe(head);
    expect(showFile(repo, 'HEAD', 'package.json')).toBe('{"version":"1.0.0"}\n');
  });
});

describe('history readers', () => {
  it('finds the nearest release tag and ignores other tags', () => {
    const repo = newRepo();
    commitFiles(repo, { 'a.txt': '1\n' }, 'one');
    run(repo, ['tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0']);
    commitFiles(repo, { 'a.txt': '2\n' }, 'two');
    run(repo, ['tag', '-a', 'v1.1.0', '-m', 'Release 1.1.0']);
    commitFiles(repo, { 'a.txt': '3\n' }, 'three');
    run(repo, ['tag', 'nightly']);
    commitFiles(repo, { 'a.txt': '4\n' }, 'four');

    expect(latestReleaseTag(repo, 'HEAD')).toBe('v1.1.0');
  });

  it('returns null when no release tag is reachable', () => {
    const repo = newRepo();
    commitFiles(repo, { 'a.txt': '1\n' }, 'one');
    expect(latestReleaseTag(repo, 'HEAD')).toBeNull();
  });

  it('skips a nearer pre-release tag such as v1.1.0-rc.1', () => {
    const repo = newRepo();
    commitFiles(repo, { 'a.txt': '1\n' }, 'one');
    run(repo, ['tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0']);
    commitFiles(repo, { 'a.txt': '2\n' }, 'two');
    run(repo, ['tag', '-a', 'v1.1.0-rc.1', '-m', 'Release candidate 1.1.0-rc.1']);
    commitFiles(repo, { 'a.txt': '3\n' }, 'three');

    expect(latestReleaseTag(repo, 'HEAD')).toBe('v1.0.0');
  });

  it('skips several nearer pre-release tags', () => {
    const repo = newRepo();
    commitFiles(repo, { 'a.txt': '1\n' }, 'one');
    run(repo, ['tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0']);
    commitFiles(repo, { 'a.txt': '2\n' }, 'two');
    run(repo, ['tag', '-a', 'v1.1.0-rc.1', '-m', 'Release candidate 1.1.0-rc.1']);
    commitFiles(repo, { 'a.txt': '3\n' }, 'three');
    run(repo, ['tag', '-a', 'v1.1.0-rc.2', '-m', 'Release candidate 1.1.0-rc.2']);
    commitFiles(repo, { 'a.txt': '4\n' }, 'four');

    expect(latestReleaseTag(repo, 'HEAD')).toBe('v1.0.0');
  });

  it('returns null when only a pre-release tag is reachable', () => {
    const repo = newRepo();
    commitFiles(repo, { 'a.txt': '1\n' }, 'one');
    run(repo, ['tag', '-a', 'v1.1.0-rc.1', '-m', 'Release candidate 1.1.0-rc.1']);
    commitFiles(repo, { 'a.txt': '2\n' }, 'two');

    expect(latestReleaseTag(repo, 'HEAD')).toBeNull();
  });

  it('lists commits with bodies and can skip merge commits', () => {
    const repo = newRepo();
    const base = commitFiles(repo, { 'a.txt': '1\n' }, 'base');
    run(repo, ['checkout', '-q', '-b', 'side']);
    commitFiles(repo, { 'b.txt': '1\n' }, 'feat: side (#7)');
    run(repo, ['checkout', '-q', 'main']);
    commitFiles(repo, { 'c.txt': '1\n' }, 'fix: main\n\nBREAKING CHANGE: drops x');
    run(repo, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side']);

    const subjects = (commits) => commits.map((commit) => commit.subject).sort();
    const all = commitsInRange(repo, `${base}..HEAD`);
    expect(subjects(all)).toEqual(['Merge branch side', 'feat: side (#7)', 'fix: main']);
    const noMerges = commitsInRange(repo, `${base}..HEAD`, { noMerges: true });
    expect(subjects(noMerges)).toEqual(['feat: side (#7)', 'fix: main']);
    const fix = noMerges.find((commit) => commit.subject === 'fix: main');
    expect(fix.body).toContain('BREAKING CHANGE: drops x');
    expect(fix.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reports ancestry, trees and changed paths', () => {
    const repo = newRepo();
    const first = commitFiles(repo, { 'a.txt': '1\n' }, 'one');
    const second = commitFiles(repo, { 'b.txt': '1\n', 'a.txt': '2\n' }, 'two');
    expect(isAncestor(repo, first, second)).toBe(true);
    expect(isAncestor(repo, second, first)).toBe(false);
    expect(treeOf(repo, second)).toBe(run(repo, ['rev-parse', `${second}^{tree}`]));
    expect(changedPaths(repo, first, second)).toEqual(['a.txt', 'b.txt']);
  });

  it('lists the paths each non-merge commit in a range changes', () => {
    const repo = newRepo();
    const base = commitFiles(repo, { 'a.txt': '1\n' }, 'base');
    run(repo, ['checkout', '-q', '-b', 'side']);
    commitFiles(repo, { 'b.txt': '1\n', 'c.txt': '1\n' }, 'feat: side (#7)');
    run(repo, ['checkout', '-q', 'main']);
    commitFiles(repo, { 'a.txt': '2\n' }, 'chore: release v1.1.0');
    run(repo, ['merge', '-q', '--no-ff', '-m', 'Merge branch side', 'side']);

    const bySubject = Object.fromEntries(
      commitPathsInRange(repo, `${base}..HEAD`).map((commit) => [commit.subject, commit.paths]),
    );
    expect(bySubject).toEqual({
      'feat: side (#7)': ['b.txt', 'c.txt'],
      'chore: release v1.1.0': ['a.txt'],
    });
  });
});

describe('fetchRefs and authEnv', () => {
  it('fetches the requested refs from a remote', () => {
    const origin = newRepo();
    const sha = commitFiles(origin, { 'a.txt': '1\n' }, 'one');
    const clone = newRepo();
    run(clone, ['remote', 'add', 'origin', origin]);

    fetchRefs(clone, 'origin', ['+refs/heads/main:refs/remotes/origin/main']);
    expect(revParse(clone, 'refs/remotes/origin/main')).toBe(sha);
  });

  it('puts a token into git config environment variables, never arguments', () => {
    expect(authEnv('abc123')).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from('x-access-token:abc123').toString('base64')}`,
    });
    expect(authEnv(undefined)).toEqual({});
  });
});
