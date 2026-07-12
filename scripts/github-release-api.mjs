#!/usr/bin/env node
/**
 * Shared GitHub release helpers for CI ensure + manual consolidation.
 */

export const OWNER = 'Colorado-Mesh';
export const REPO = 'mesh-client';
export const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;

/** Release tags must be vX.Y.Z — validated before any GitHub API call (CodeQL file-access-to-http). */
export const SAFE_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/;

export function versionFromTag(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

export function fail(message) {
  console.error(`[github-release] ${message}`);
  process.exit(1);
}

export function assertSafeReleaseTag(tag) {
  if (typeof tag !== 'string' || !SAFE_RELEASE_TAG_RE.test(tag)) {
    fail(`Release tag must match vX.Y.Z (got ${JSON.stringify(tag)})`);
  }
  return tag;
}

export function resolveTag(argv, env) {
  const flagIndex = argv.indexOf('--tag');
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return assertSafeReleaseTag(argv[flagIndex + 1]);
  }
  const fromEnv = env.RELEASE_TAG;
  if (typeof fromEnv === 'string' && fromEnv) {
    return assertSafeReleaseTag(fromEnv);
  }
  const ref = env.GITHUB_REF ?? '';
  if (ref.startsWith('refs/tags/')) {
    return assertSafeReleaseTag(ref.slice('refs/tags/'.length));
  }
  fail('Missing tag: pass --tag vX.Y.Z, set RELEASE_TAG, or run on a refs/tags/v* workflow ref');
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
  assertSafeReleaseTag(tag);
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
 * @deprecated Prefer normalizeDraftReleasesForTag, which also merges duplicates that hold assets.
 */
export async function dedupeEmptyDraftReleases(tag, token, log = console.debug) {
  return normalizeDraftReleasesForTag(tag, token, { log });
}

export async function downloadReleaseAsset(assetId, token) {
  const response = await fetch(`${API_ROOT}/releases/assets/${assetId}`, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    fail(`Download release asset ${assetId} failed (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function consolidateReleases({ tag, token, targetCommitish, log = console.debug }) {
  const releases = await listReleasesForTag(tag, token);
  if (releases.length === 0) {
    fail(`No releases found for ${tag}`);
  }
  if (releases.length === 1) {
    log(`[github-release] Single release ${releases[0].id} — nothing to merge`);
    return releases[0];
  }

  const keeper = pickCanonicalRelease(releases);
  const keeperAssetNames = new Set((keeper.assets ?? []).map((asset) => asset.name));
  let bestBody = keeper.body ?? '';
  let moved = 0;

  log(
    `[github-release] Canonical release ${keeper.id} (${keeperAssetNames.size} assets); ` +
      `${releases.length - 1} duplicate(s) to merge/delete`,
  );

  for (const release of releases) {
    if (release.id === keeper.id) {
      continue;
    }

    if ((release.body?.length ?? 0) > bestBody.length) {
      bestBody = release.body;
    }

    for (const asset of release.assets ?? []) {
      if (keeperAssetNames.has(asset.name)) {
        log(
          `[github-release] Skipping duplicate asset name ${asset.name} on release ${release.id}`,
        );
        await deleteReleaseAsset(asset.id, token);
        continue;
      }

      log(`[github-release] Moving ${asset.name} from release ${release.id} → ${keeper.id}`);
      const bytes = await downloadReleaseAsset(asset.id, token);
      await uploadReleaseAsset(keeper.id, asset.name, bytes, token);
      await deleteReleaseAsset(asset.id, token);
      keeperAssetNames.add(asset.name);
      moved += 1;
    }

    await deleteRelease(release.id, token);
    log(`[github-release] Deleted duplicate release ${release.id} for ${tag}`);
  }

  const patch = {
    tag_name: tag,
    name: versionFromTag(tag),
    draft: true,
  };
  if (targetCommitish) {
    patch.target_commitish = targetCommitish;
  }
  if (bestBody && bestBody !== keeper.body) {
    patch.body = bestBody;
  }

  const updated = await patchRelease(keeper.id, token, patch);
  log(
    `[github-release] Consolidated ${tag} — release ${updated.id} has ${updated.assets?.length ?? keeperAssetNames.size} assets (moved ${moved})`,
  );
  return updated;
}

/**
 * Ensure at most one draft release exists for a tag. Merges split assets when parallel
 * publish jobs forked duplicate drafts (including untagged-e* names matched by release name).
 */
export async function normalizeDraftReleasesForTag(
  tag,
  token,
  { targetCommitish, log = console.debug } = {},
) {
  const releases = await listReleasesForTag(tag, token);
  if (releases.length === 0) {
    return null;
  }

  if (releases.length > 1) {
    return consolidateReleases({ tag, token, targetCommitish, log });
  }

  const release = releases[0];
  const patch = {};
  if (release.tag_name !== tag) {
    patch.tag_name = tag;
    patch.name = versionFromTag(tag);
    patch.draft = true;
  }
  if (targetCommitish && release.target_commitish !== targetCommitish) {
    patch.target_commitish = targetCommitish;
    patch.draft = true;
  }
  if (Object.keys(patch).length === 0) {
    return release;
  }

  const updated = await patchRelease(release.id, token, patch);
  log(`[github-release] Repaired release ${updated.id} metadata for ${tag}`);
  return updated;
}

export async function ensureGithubDraftRelease({
  tag,
  token,
  targetCommitish,
  log = console.debug,
}) {
  let keeper = await normalizeDraftReleasesForTag(tag, token, { targetCommitish, log });
  if (keeper) {
    log(`[ci-ensure-github-draft-release] Using release ${keeper.id} for ${tag}`);
    return keeper;
  }

  keeper = await createDraftRelease(tag, token, targetCommitish);
  log(`[ci-ensure-github-draft-release] Created draft release ${keeper.id} for ${tag}`);
  return keeper;
}
