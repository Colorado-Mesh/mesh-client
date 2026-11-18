// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createGithubApi, resolveRepo, resolveToken } from './releaseGithub.mjs';

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fetch stand-in keyed by path (and query) that records every URL and header it saw. */
function fakeFetch(routes) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers });
    const parsed = new URL(url);
    const key = `${parsed.pathname}${parsed.search}`;
    const route = routes[key];
    if (!route) return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) };
    const [status, body] = route;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, seen };
}

const base = '/repos/Colorado-Mesh/mesh-client';

describe('createGithubApi', () => {
  it('paginates check runs until a short page', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `job ${index}`,
    }));
    const { fetchImpl, seen } = fakeFetch({
      [`${base}/commits/abc/check-runs?filter=latest&per_page=100&page=1`]: [
        200,
        { total_count: 101, check_runs: firstPage },
      ],
      [`${base}/commits/abc/check-runs?filter=latest&per_page=100&page=2`]: [
        200,
        { total_count: 101, check_runs: [{ id: 101, name: 'last' }] },
      ],
    });
    const api = createGithubApi({ token: 't0ken', repo: 'Colorado-Mesh/mesh-client', fetchImpl });

    const runs = await api.listCheckRuns('abc');

    expect(runs).toHaveLength(101);
    expect(runs.at(-1).name).toBe('last');
    expect(seen).toHaveLength(2);
    expect(seen[0].headers.Authorization).toBe('Bearer t0ken');
  });

  it('maps a missing tag to false and throws on other errors', async () => {
    const { fetchImpl } = fakeFetch({
      [`${base}/git/ref/tags/v6.8.0`]: [200, { object: { sha: 't46', type: 'tag' } }],
      [`${base}/commits/b00m/pulls`]: [500, { message: 'boom' }],
    });
    const api = createGithubApi({ token: 't', repo: 'Colorado-Mesh/mesh-client', fetchImpl });

    expect(await api.tagExists('v6.8.0')).toBe(true);
    expect(await api.tagExists('v6.9.0')).toBe(false);
    await expect(api.pullsForCommit('b00m')).rejects.toThrow(/500/);
  });

  it('names the workflow file behind a check suite, or null when no workflow made it', async () => {
    const { fetchImpl } = fakeFetch({
      [`${base}/actions/runs?check_suite_id=77`]: [
        200,
        { total_count: 1, workflow_runs: [{ path: '.github/workflows/e2e.yaml' }] },
      ],
      [`${base}/actions/runs?check_suite_id=78`]: [200, { total_count: 0, workflow_runs: [] }],
    });
    const api = createGithubApi({ token: 't', repo: 'Colorado-Mesh/mesh-client', fetchImpl });

    expect(await api.workflowPathForCheckSuite(77)).toBe('.github/workflows/e2e.yaml');
    expect(await api.workflowPathForCheckSuite(78)).toBeNull();
  });

  it('drops the ref GitHub may append to a workflow path, and keeps a repository prefix', async () => {
    // The REST schema's example for a workflow run path is "octocat/octo-repo/.github/workflows/ci.yml@main".
    const { fetchImpl } = fakeFetch({
      [`${base}/actions/runs?check_suite_id=79`]: [
        200,
        { total_count: 1, workflow_runs: [{ path: '.github/workflows/e2e.yaml@refs/heads/main' }] },
      ],
      [`${base}/actions/runs?check_suite_id=80`]: [
        200,
        {
          total_count: 1,
          workflow_runs: [{ path: 'octocat/octo-repo/.github/workflows/e2e.yaml@main' }],
        },
      ],
    });
    const api = createGithubApi({ token: 't', repo: 'Colorado-Mesh/mesh-client', fetchImpl });

    expect(await api.workflowPathForCheckSuite(79)).toBe('.github/workflows/e2e.yaml');
    expect(await api.workflowPathForCheckSuite(80)).toBe(
      'octocat/octo-repo/.github/workflows/e2e.yaml',
    );
  });

  it('reads the tree a commit points at', async () => {
    const { fetchImpl } = fakeFetch({
      [`${base}/git/commits/c0mm1t`]: [200, { sha: 'c0mm1t', tree: { sha: 'tr33' } }],
    });
    const api = createGithubApi({ token: 't', repo: 'Colorado-Mesh/mesh-client', fetchImpl });

    expect(await api.commitTreeSha('c0mm1t')).toBe('tr33');
    await expect(api.commitTreeSha('m1ss1ng')).rejects.toThrow(/404/);
  });

  it('follows an annotated tag to its message and returns null for a lightweight tag', async () => {
    const { fetchImpl } = fakeFetch({
      [`${base}/git/ref/tags/v6.9.0`]: [200, { object: { sha: 'tagobj', type: 'tag' } }],
      [`${base}/git/tags/tagobj`]: [200, { message: '### Features\n\n- feat: maps (#1)\n' }],
      [`${base}/git/ref/tags/v6.8.0`]: [200, { object: { sha: 'c0mm1t', type: 'commit' } }],
    });
    const api = createGithubApi({ token: 't', repo: 'Colorado-Mesh/mesh-client', fetchImpl });

    expect(await api.annotatedTagMessage('v6.9.0')).toBe('### Features\n\n- feat: maps (#1)\n');
    expect(await api.annotatedTagMessage('v6.8.0')).toBeNull();
    expect(await api.annotatedTagMessage('v1.0.0')).toBeNull();
  });

  it('lists the pull requests that contain a commit', async () => {
    const { fetchImpl } = fakeFetch({
      [`${base}/commits/m3rge/pulls`]: [200, [{ number: 12, merge_commit_sha: 'm3rge' }]],
    });
    const api = createGithubApi({ token: 't', repo: 'Colorado-Mesh/mesh-client', fetchImpl });
    expect(await api.pullsForCommit('m3rge')).toEqual([{ number: 12, merge_commit_sha: 'm3rge' }]);
  });
});

describe('resolveRepo', () => {
  function repoWithOrigin(url) {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'mesh-release-repo-'));
    dirs.push(repo);
    spawnSync('git', ['init', '-q', repo]);
    spawnSync('git', ['remote', 'add', 'origin', url], { cwd: repo });
    return repo;
  }

  it('prefers an explicit argument, then GITHUB_REPOSITORY', () => {
    expect(resolveRepo({ env: { GITHUB_REPOSITORY: 'a/b' }, argRepo: 'c/d', cwd: '.' })).toBe(
      'c/d',
    );
    expect(resolveRepo({ env: { GITHUB_REPOSITORY: 'a/b' }, cwd: '.' })).toBe('a/b');
    expect(() => resolveRepo({ env: {}, argRepo: 'not a repo', cwd: '.' })).toThrow(/owner\/name/);
  });

  it('reads https and ssh origin URLs', () => {
    expect(
      resolveRepo({
        env: {},
        cwd: repoWithOrigin('https://github.com/Colorado-Mesh/mesh-client.git'),
      }),
    ).toBe('Colorado-Mesh/mesh-client');
    expect(
      resolveRepo({ env: {}, cwd: repoWithOrigin('git@github.com:someone/sandbox.git') }),
    ).toBe('someone/sandbox');
  });
});

describe('resolveToken', () => {
  it('uses GH_TOKEN, then GITHUB_TOKEN, then gh', () => {
    expect(resolveToken({ env: { GH_TOKEN: 'a', GITHUB_TOKEN: 'b' } })).toBe('a');
    expect(resolveToken({ env: { GITHUB_TOKEN: 'b' } })).toBe('b');
    expect(resolveToken({ env: {}, ghTokenFn: () => 'c' })).toBe('c');
    expect(() => resolveToken({ env: {}, ghTokenFn: () => '' })).toThrow(/GH_TOKEN/);
  });
});
