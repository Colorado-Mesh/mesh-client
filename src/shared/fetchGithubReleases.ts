import type { GithubReleaseRow } from '@/shared/githubReleaseVersion';

export const GITHUB_RELEASES_PAGE_SIZE = 100;

export function githubReleasesListUrl(repo: string, page: number): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=${GITHUB_RELEASES_PAGE_SIZE}&page=${page}`;
}

export async function fetchAllGithubReleases(
  repo: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
  pageSize: number = GITHUB_RELEASES_PAGE_SIZE,
): Promise<GithubReleaseRow[]> {
  const headers = { 'User-Agent': userAgent };
  const all: GithubReleaseRow[] = [];
  let page = 1;
  while (true) {
    const res = await fetchImpl(
      `https://api.github.com/repos/${repo}/releases?per_page=${pageSize}&page=${page}`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`GitHub API responded with ${String(res.status)}`);
    }
    const data = (await res.json()) as GithubReleaseRow[];
    if (!Array.isArray(data)) {
      throw new Error('Unexpected GitHub releases payload');
    }
    all.push(...data);
    if (data.length < pageSize) {
      break;
    }
    page += 1;
  }
  return all;
}
