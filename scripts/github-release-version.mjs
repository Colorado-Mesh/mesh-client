#!/usr/bin/env node
/**
 * Shared GitHub release version/tag identity helpers (CI scripts + parity with src/shared).
 */

/** Release display names are X.Y.Z (no leading v) on GitHub Releases. */
export const SAFE_RELEASE_NAME_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * @param {string} raw
 * @returns {number}
 */
export function trustedSemverComponent(raw) {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Unsafe release tag component: ${JSON.stringify(raw)}`);
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`Unsafe release tag component: ${JSON.stringify(raw)}`);
  }
  return n;
}

/**
 * @param {unknown} tag
 * @returns {string}
 */
export function trustedReleaseTag(tag) {
  const m = typeof tag === 'string' ? /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) : null;
  if (!m) {
    throw new Error(`Unsafe release tag: ${JSON.stringify(tag)}`);
  }
  return `v${trustedSemverComponent(m[1])}.${trustedSemverComponent(m[2])}.${trustedSemverComponent(m[3])}`;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function compareReleaseTags(a, b) {
  const pa = trustedReleaseTag(a).slice(1).split('.').map(Number);
  const pb = trustedReleaseTag(b).slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * @param {{ tag_name?: unknown, name?: unknown }} release
 * @returns {boolean}
 */
export function isUntaggedPlaceholderTag(tag) {
  return typeof tag === 'string' && /^untagged-/i.test(tag);
}

/**
 * @param {{ draft?: unknown, prerelease?: unknown }} release
 * @returns {boolean}
 */
function hasReleaseVisibilityFields(release) {
  return typeof release.draft === 'boolean' && typeof release.prerelease === 'boolean';
}

/**
 * Resolve a trusted `vX.Y.Z` from a release row when tag is valid or untagged/missing + name.
 *
 * @param {{ tag_name?: unknown, name?: unknown, draft?: unknown, prerelease?: unknown } | null | undefined} release
 * @param {{ includeDrafts?: boolean, includePrereleases?: boolean }} [opts]
 * @returns {string | null}
 */
export function releaseGitTagFromRow(release, opts = {}) {
  if (!release) {
    return null;
  }
  if (!hasReleaseVisibilityFields(release)) {
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
      return trustedReleaseTag(
        `v${trustedSemverComponent(m[1])}.${trustedSemverComponent(m[2])}.${trustedSemverComponent(m[3])}`,
      );
    }
  }
  return null;
}

/**
 * Map a published GitHub Releases API row to a trusted git tag (skips drafts/prereleases).
 *
 * @param {{ tag_name?: unknown, name?: unknown, draft?: unknown, prerelease?: unknown } | null | undefined} release
 * @returns {string | null}
 */
export function publishedReleaseGitTag(release) {
  return releaseGitTagFromRow(release, { includeDrafts: false, includePrereleases: false });
}

/**
 * @param {{ tag_name?: unknown, name?: unknown, draft?: unknown }} release
 * @param {string} tag trusted vX.Y.Z
 * @returns {boolean}
 */
export function releaseMatchesTag(release, tag) {
  const resolved = releaseGitTagFromRow(release, { includeDrafts: true, includePrereleases: true });
  if (resolved === tag) {
    return true;
  }
  if (release.tag_name === tag) {
    return true;
  }
  if (release.draft === true && typeof release.name === 'string') {
    const tagMissing = release.tag_name == null || release.tag_name === '';
    const tagUntagged = isUntaggedPlaceholderTag(release.tag_name);
    if ((tagMissing || tagUntagged) && release.name === versionFromTrustedTag(tag)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} tag
 * @returns {string}
 */
export function versionFromTrustedTag(tag) {
  return trustedReleaseTag(tag).slice(1);
}

/**
 * @param {Array<{ tag_name?: unknown, name?: unknown, draft?: unknown, prerelease?: unknown, html_url?: unknown }>} releases
 * @param {string} [excludeTag]
 * @returns {string | null}
 */
export function pickLatestPublishedReleaseTag(releases, excludeTag) {
  if (!Array.isArray(releases)) {
    return null;
  }
  /** @type {string[]} */
  const candidates = [];
  for (const release of releases) {
    const tag = publishedReleaseGitTag(release);
    if (!tag) continue;
    if (excludeTag && tag === excludeTag) continue;
    candidates.push(tag);
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => compareReleaseTags(b, a));
  return candidates[0];
}

/**
 * @param {Array<{ tag_name?: unknown, name?: unknown, draft?: unknown, prerelease?: unknown, html_url?: unknown }>} releases
 * @param {string} [excludeTag]
 * @returns {{ tag: string, version: string, releaseUrl: string } | null}
 */
export function pickLatestPublishedRelease(releases, excludeTag) {
  if (!Array.isArray(releases)) {
    return null;
  }
  /** @type {Array<{ tag: string, version: string, releaseUrl: string }>} */
  const candidates = [];
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
  return candidates[0];
}
