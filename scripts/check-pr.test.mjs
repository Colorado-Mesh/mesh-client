import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { branchTouchesSidecar, resolvePrMergeBase } from './check-pr.mjs';

describe('check-pr branchTouchesSidecar', () => {
  it('detects reticulum-sidecar and related scripts', () => {
    expect(branchTouchesSidecar(['src/renderer/App.tsx'])).toBe(false);
    expect(branchTouchesSidecar(['reticulum-sidecar/src/main.rs'])).toBe(true);
    expect(branchTouchesSidecar(['scripts/check-reticulum-sidecar.sh'])).toBe(true);
    expect(branchTouchesSidecar(['docs/reticulum.md', 'scripts/clone-ratspeak-stack.sh'])).toBe(
      true,
    );
  });
});

describe('check-pr resolvePrMergeBase', () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const git = (cwd, args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };

  /** main <- staging <- feature, with remote-tracking refs for the first two. */
  function branchRepo() {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'mesh-check-pr-'));
    dirs.push(repo);
    git(repo, ['init', '-q', '-b', 'feature']);
    const commit = (message) => {
      git(repo, [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        message,
      ]);
      return git(repo, ['rev-parse', 'HEAD']);
    };
    const main = commit('main');
    const staging = commit('staging');
    commit('feature');
    return { repo, main, staging };
  }

  it('prefers origin/staging, the branch pull requests target', () => {
    const { repo, main, staging } = branchRepo();
    git(repo, ['update-ref', 'refs/remotes/origin/main', main]);
    git(repo, ['update-ref', 'refs/remotes/origin/staging', staging]);
    expect(resolvePrMergeBase({ cwd: repo })).toEqual({ branch: 'staging', mergeBase: staging });
  });

  it('falls back to origin/main before staging exists', () => {
    const { repo, main } = branchRepo();
    git(repo, ['update-ref', 'refs/remotes/origin/main', main]);
    expect(resolvePrMergeBase({ cwd: repo })).toEqual({ branch: 'main', mergeBase: main });
  });

  it('returns null without either remote branch', () => {
    const { repo } = branchRepo();
    expect(resolvePrMergeBase({ cwd: repo })).toBeNull();
  });
});
