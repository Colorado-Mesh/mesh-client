/**
 * A small GitHub REST client for the promotion tooling. The repository comes from the caller
 * (`GITHUB_REPOSITORY`, `--repo` or the origin remote), never from a constant, so the same
 * scripts run in any repository that adopts the flow.
 */
import { execFileSync } from 'node:child_process';

const API_BASE = 'https://api.github.com';
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ORIGIN_PATTERN = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/**
 * @param {{ env?: Record<string, string | undefined>, argRepo?: string, cwd: string }} options
 * @returns {string} owner/name
 */
export function resolveRepo({ env = process.env, argRepo, cwd }) {
  if (argRepo !== undefined) {
    if (!REPO_PATTERN.test(argRepo)) {
      throw new Error(`--repo must be owner/name, got ${JSON.stringify(argRepo)}`);
    }
    return argRepo;
  }
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
    cwd,
    encoding: 'utf8',
  }).trim();
  const match = ORIGIN_PATTERN.exec(url);
  if (!match) {
    throw new Error('Cannot read owner/name from the origin remote URL; pass --repo owner/name');
  }
  return match[1];
}

/**
 * @param {{ env?: Record<string, string | undefined>, ghTokenFn?: () => string }} options
 * @returns {string}
 */
export function resolveToken({ env = process.env, ghTokenFn }) {
  const fromEnv = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  const fromGh = ghTokenFn?.();
  if (fromGh) return fromGh;
  throw new Error('Set GH_TOKEN or GITHUB_TOKEN, or sign in with gh auth login');
}

/**
 * @param {{ token: string, repo: string, fetchImpl?: typeof fetch }} options
 */
export function createGithubApi({ token, repo, fetchImpl = fetch }) {
  /**
   * @param {string} pathname - path below /repos/{owner}/{name}, with any query string
   * @param {{ allowMissing?: boolean }} [options]
   */
  async function request(pathname, { allowMissing = false } = {}) {
    const response = await fetchImpl(`${API_BASE}/repos/${repo}${pathname}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) {
      throw new Error(`GitHub API ${pathname.split('?')[0]} answered ${response.status}`);
    }
    return response.json();
  }

  /**
   * @param {string} pathname
   * @param {string} key - the array property of each page
   */
  async function paginate(pathname, key) {
    const items = [];
    const separator = pathname.includes('?') ? '&' : '?';
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await request(`${pathname}${separator}per_page=${PAGE_SIZE}&page=${page}`);
      const batch = body?.[key] ?? [];
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return items;
  }

  async function ref(name) {
    return request(`/git/ref/${name}`, { allowMissing: true });
  }

  return {
    /** @param {number} number */
    getPull: (number) => request(`/pulls/${number}`),
    /** @param {string} name @returns {Promise<string | null>} */
    branchSha: async (name) => (await ref(`heads/${name}`))?.object?.sha ?? null,
    /** @param {string} sha */
    listCheckRuns: (sha) => paginate(`/commits/${sha}/check-runs?filter=latest`, 'check_runs'),
    /** @param {string} sha */
    combinedStatuses: (sha) => paginate(`/commits/${sha}/status`, 'statuses'),
    /** @param {string} tag @returns {Promise<boolean>} */
    tagExists: async (tag) => (await ref(`tags/${tag}`)) !== null,
    /** @param {string} sha */
    pullsForCommit: (sha) => request(`/commits/${sha}/pulls`),
    /** @param {string} tag @returns {Promise<string | null>} */
    annotatedTagMessage: async (tag) => {
      const tagRef = await ref(`tags/${tag}`);
      if (!tagRef || tagRef.object?.type !== 'tag') return null;
      const tagObject = await request(`/git/tags/${tagRef.object.sha}`);
      return tagObject?.message ?? null;
    },
  };
}
