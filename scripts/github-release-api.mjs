#!/usr/bin/env node
/**
 * Shared GitHub release helpers for CI ensure + manual consolidation.
 */

import fs from 'node:fs';
import path from 'node:path';

export const OWNER = 'Colorado-Mesh';
export const REPO = 'mesh-client';
export const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;

export function versionFromTag(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

export function fail(message) {
  console.error(`[github-release] ${message}`);
  process.exit(1);
}

export function resolveTagFromPackageVersion(cwd = process.cwd()) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fail('package.json not found for release tag resolution');
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Failed to parse package.json for release tag resolution: ${detail}`);
  }
  if (typeof pkg.version !== 'string' || !pkg.version) {
    fail('package.json is missing a valid "version" field for release tag resolution');
  }
  return `v${pkg.version}`;
}

export function resolveTag(argv, env, { cwd = process.cwd() } = {}) {
  const flagIndex = argv.indexOf('--tag');
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }
  const ref = env.GITHUB_REF ?? '';
  if (ref.startsWith('refs/tags/')) {
    return ref.slice('refs/tags/'.length);
  }
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    return resolveTagFromPackageVersion(cwd);
  }
  fail(
    'Missing tag: pass --tag vX.Y.Z, run on a refs/tags/v* workflow ref, or use workflow_dispatch',
  );
}

export function authToken(env) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) {
    fail('GH_TOKEN or GITHUB_TOKEN is required');
  }
  return token;
}

export async function githubRequest(path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    },
    body:
      body instanceof FormData
        ? body
        : body && !(body instanceof FormData)
          ? JSON.stringify(body)
          : undefined,
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
  }

  return { response, json };
}

export function releaseMatchesTag(release, tag) {
  const version = versionFromTag(tag);
  return release.tag_name === tag || (release.draft === true && release.name === version);
}

export async function listReleasesForTag(tag, token) {
  const matches = [];
  for (let page = 1; page <= 5; page += 1) {
    const { response, json } = await githubRequest(`/releases?per_page=100&page=${page}`, {
      token,
    });
    if (!response.ok) {
      fail(`List releases failed (${response.status}): ${json?.message ?? response.statusText}`);
    }
    if (!Array.isArray(json) || json.length === 0) {
      break;
    }
    for (const release of json) {
      if (releaseMatchesTag(release, tag)) {
        matches.push(release);
      }
    }
    if (json.length < 100) {
      break;
    }
  }
  return matches;
}

export function pickCanonicalRelease(releases) {
  return [...releases].sort((a, b) => {
    const assetDelta = (b.assets?.length ?? 0) - (a.assets?.length ?? 0);
    if (assetDelta !== 0) {
      return assetDelta;
    }
    const bodyDelta = (b.body?.length ?? 0) - (a.body?.length ?? 0);
    if (bodyDelta !== 0) {
      return bodyDelta;
    }
    return b.id - a.id;
  })[0];
}

export async function deleteRelease(releaseId, token) {
  const { response, json } = await githubRequest(`/releases/${releaseId}`, {
    token,
    method: 'DELETE',
  });
  if (!response.ok) {
    fail(
      `DELETE release ${releaseId} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }
}

export async function deleteReleaseAsset(assetId, token) {
  const { response, json } = await githubRequest(`/releases/assets/${assetId}`, {
    token,
    method: 'DELETE',
  });
  if (!response.ok) {
    fail(
      `DELETE asset ${assetId} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }
}

export function resolveTargetCommitish(env) {
  const sha = env.GITHUB_SHA ?? env.RELEASE_TARGET_COMMITISH;
  if (typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha)) {
    return sha;
  }
  return undefined;
}

export async function createDraftRelease(tag, token, targetCommitish) {
  const version = versionFromTag(tag);
  const { response, json } = await githubRequest('/releases', {
    token,
    method: 'POST',
    body: {
      tag_name: tag,
      target_commitish: targetCommitish ?? tag,
      name: version,
      draft: true,
      generate_release_notes: false,
      body: `Draft release for ${tag}. CI is uploading platform artifacts.`,
    },
  });

  if (response.status === 422) {
    const existing = (await listReleasesForTag(tag, token))[0];
    if (existing) {
      return existing;
    }
  }

  if (!response.ok) {
    fail(
      `POST draft release for ${tag} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }

  return json;
}

export async function patchRelease(releaseId, token, patch) {
  const { response, json } = await githubRequest(`/releases/${releaseId}`, {
    token,
    method: 'PATCH',
    body: patch,
  });
  if (!response.ok) {
    fail(
      `PATCH release ${releaseId} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }
  return json;
}

export async function uploadReleaseAsset(releaseId, fileName, bytes, token) {
  const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: bytes,
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
  }

  if (!response.ok) {
    fail(
      `Upload asset ${fileName} to release ${releaseId} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }

  return json;
}

/**
 * Delete empty duplicate draft releases for a tag. Returns the canonical release, if any.
 */
export async function dedupeEmptyDraftReleases(tag, token, log = console.debug) {
  const releases = await listReleasesForTag(tag, token);
  if (releases.length === 0) {
    return null;
  }

  const keeper = pickCanonicalRelease(releases);
  for (const release of releases) {
    if (release.id === keeper.id) {
      continue;
    }
    if ((release.assets?.length ?? 0) > 0) {
      fail(
        `Duplicate draft release ${release.id} for ${tag} still has ${release.assets.length} asset(s). ` +
          'Run scripts/consolidate-github-release-duplicates.mjs before re-running CI.',
      );
    }
    await deleteRelease(release.id, token);
    log(`[github-release] Deleted empty duplicate release ${release.id} for ${tag}`);
  }

  return keeper;
}

export async function ensureGithubDraftRelease({
  tag,
  token,
  targetCommitish,
  log = console.debug,
}) {
  let keeper = await dedupeEmptyDraftReleases(tag, token, log);
  if (keeper) {
    if (targetCommitish && keeper.target_commitish !== targetCommitish) {
      keeper = await patchRelease(keeper.id, token, {
        tag_name: tag,
        target_commitish: targetCommitish,
        draft: true,
      });
      log(`[ci-ensure-github-draft-release] Repaired target_commitish on release ${keeper.id}`);
    }
    log(`[ci-ensure-github-draft-release] Using release ${keeper.id} for ${tag}`);
    return keeper;
  }

  keeper = await createDraftRelease(tag, token, targetCommitish);
  log(`[ci-ensure-github-draft-release] Created draft release ${keeper.id} for ${tag}`);
  return keeper;
}
