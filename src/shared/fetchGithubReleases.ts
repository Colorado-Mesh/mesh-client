import type { GithubReleaseRow } from '@/shared/githubReleaseVersion';

export const GITHUB_RELEASES_PAGE_SIZE = 100;

/** Gzip magic bytes — Electron fetch sometimes returns a compressed body without decoding it. */
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export function githubReleasesListUrl(repo: string, page: number): string {
  return `https://api.github.com/repos/${repo}/releases?per_page=${GITHUB_RELEASES_PAGE_SIZE}&page=${page}`;
}

function isGzipBody(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

/**
 * Decode a GitHub API response body to text, gunzipping when the runtime left
 * Content-Encoding applied (seen with Electron main `fetch` → invalid JSON).
 */
export async function decodeGithubApiBody(bytes: Uint8Array): Promise<string> {
  if (!isGzipBody(bytes)) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('GitHub API returned gzip but DecompressionStream is unavailable');
  }
  // Copy into a fresh ArrayBuffer — Uint8Array<ArrayBufferLike> is not BodyInit under strict TS.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const body = new Response(ab).body;
  if (!body) {
    throw new Error('GitHub API gzip body stream unavailable');
  }
  return new Response(body.pipeThrough(new DecompressionStream('gzip'))).text();
}

export async function parseGithubReleasesJson(bytes: Uint8Array): Promise<GithubReleaseRow[]> {
  const text = await decodeGithubApiBody(bytes);
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`GitHub API returned non-JSON body (${detail})`);
  }
  if (!Array.isArray(data)) {
    throw new Error('Unexpected GitHub releases payload');
  }
  return data as GithubReleaseRow[];
}

export async function fetchAllGithubReleases(
  repo: string,
  userAgent: string,
  fetchImpl: typeof fetch = fetch,
  pageSize: number = GITHUB_RELEASES_PAGE_SIZE,
): Promise<GithubReleaseRow[]> {
  // Prefer uncompressed JSON. Some Electron main-process fetch paths still deliver
  // gzip bytes; parseGithubReleasesJson gunzips those as a fallback.
  const headers = {
    'User-Agent': userAgent,
    Accept: 'application/vnd.github+json',
    'Accept-Encoding': 'identity',
  };
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
    const bytes = new Uint8Array(await res.arrayBuffer());
    const data = await parseGithubReleasesJson(bytes);
    all.push(...data);
    if (data.length < pageSize) {
      break;
    }
    page += 1;
  }
  return all;
}
