/** Release display names are X.Y.Z (no leading v) on GitHub Releases. */
export const SAFE_RELEASE_NAME_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export interface GithubReleaseRow {
  tag_name?: unknown;
  name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
}

export interface PublishedReleasePick {
  tag: string;
  version: string;
  releaseUrl: string;
}

export function trustedReleaseTag(tag: unknown): string {
  const m = typeof tag === 'string' ? /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) : null;
  if (!m) {
    throw new Error(`Unsafe release tag: ${JSON.stringify(tag)}`);
  }
  return `v${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
}

export function compareReleaseTags(a: string, b: string): number {
  const pa = trustedReleaseTag(a).slice(1).split('.').map(Number);
  const pb = trustedReleaseTag(b).slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const aPart = pa[i] ?? 0;
    const bPart = pb[i] ?? 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  return 0;
}

export function isUntaggedPlaceholderTag(tag: unknown): boolean {
  return typeof tag === 'string' && /^untagged-/i.test(tag);
}

export function releaseGitTagFromRow(
  release: GithubReleaseRow | null | undefined,
  opts: { includeDrafts?: boolean; includePrereleases?: boolean } = {},
): string | null {
  if (!release) {
    return null;
  }
  const includeDrafts = opts.includeDrafts === true;
  const includePrereleases = opts.includePrereleases === true;
  if (!includeDrafts && release.draft === true) {
    return null;
  }
  if (!includePrereleases && release.prerelease === true) {
    return null;
  }

  const tag = release.tag_name;
  if (typeof tag === 'string' && /^v\d+\.\d+\.\d+$/.test(tag)) {
    return trustedReleaseTag(tag);
  }

  const tagMissing = tag == null || tag === '';
  const tagUntagged = isUntaggedPlaceholderTag(tag);
  if (!tagMissing && !tagUntagged) {
    return null;
  }

  const name = release.name;
  if (typeof name === 'string') {
    const m = SAFE_RELEASE_NAME_RE.exec(name);
    if (m) {
      return trustedReleaseTag(`v${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`);
    }
  }
  return null;
}

/** Map a published GitHub Releases API row to a trusted git tag (skips drafts/prereleases). */
export function publishedReleaseGitTag(
  release: GithubReleaseRow | null | undefined,
): string | null {
  return releaseGitTagFromRow(release, { includeDrafts: false, includePrereleases: false });
}

export function versionFromTrustedTag(tag: string): string {
  return trustedReleaseTag(tag).slice(1);
}

export function pickLatestPublishedRelease(
  releases: GithubReleaseRow[],
  excludeTag?: string,
): PublishedReleasePick | null {
  if (!Array.isArray(releases)) {
    return null;
  }
  const candidates: PublishedReleasePick[] = [];
  for (const release of releases) {
    const tag = publishedReleaseGitTag(release);
    if (!tag) continue;
    if (excludeTag && tag === excludeTag) continue;
    const releaseUrl = typeof release.html_url === 'string' ? release.html_url : null;
    if (!releaseUrl) continue;
    candidates.push({ tag, version: versionFromTrustedTag(tag), releaseUrl });
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => compareReleaseTags(b.tag, a.tag));
  return candidates[0] ?? null;
}

export function semverGt(remote: string, local: string): boolean {
  return compareReleaseTags(`v${remote.replace(/^v/, '')}`, `v${local.replace(/^v/, '')}`) > 0;
}
