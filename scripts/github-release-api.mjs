#!/usr/bin/env node
/**
 * Shared GitHub release helpers for CI ensure + manual consolidation.
 */

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

export const OWNER = 'Colorado-Mesh';
export const REPO = 'mesh-client';
export const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;

/** Release tags must be vX.Y.Z — validated before any GitHub API call (CodeQL file-access-to-http). */
export const SAFE_RELEASE_TAG_RE = /^v\d+\.\d+\.\d+$/;

/** Positive GitHub release ids as decimal digits (validated before Number conversion). */
export const SAFE_GITHUB_RELEASE_ID_RE = /^([1-9]\d{0,18})$/;

export function versionFromTag(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * Strip control chars (incl. newlines) and collapse whitespace before logging so
 * user/CLI-controlled text can't inject fake log lines (jssecurity:S5145). Mirrors
 * src/main/sanitize-log-message.ts's sanitizeForLogSink pattern for this standalone script.
 */
function sanitizeForLog(message) {
  return String(message)
    .replace(/[\x00-\x1F\x7F\u2028\u2029]+/g, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim();
}

export function fail(message) {
  console.error(`[github-release] ${sanitizeForLog(message)}`);
  process.exit(1);
}

export function assertSafeReleaseTag(tag) {
  if (typeof tag !== 'string' || !SAFE_RELEASE_TAG_RE.test(tag)) {
    fail(`Release tag must match vX.Y.Z (got ${JSON.stringify(tag)})`);
  }
  return tag;
}

/**
 * Reconstruct a trusted positive release id from validated digits (breaks CodeQL
 * `js/http-to-file-access` taint from GitHub release JSON → GITHUB_OUTPUT writes).
 * Rejects values outside Number.MAX_SAFE_INTEGER so URL/log interpolation stays exact.
 * @param {unknown} value
 * @returns {number}
 */
export function trustedGithubReleaseId(value) {
  const m = SAFE_GITHUB_RELEASE_ID_RE.exec(String(value ?? ''));
  if (!m) {
    fail(`GitHub release id must be a positive integer (got ${JSON.stringify(value)})`);
    return /** @type {never} */ (0);
  }
  const id = Number(m[1]);
  if (!Number.isSafeInteger(id) || id < 1) {
    fail(`GitHub release id must be <= Number.MAX_SAFE_INTEGER (got ${JSON.stringify(value)})`);
    return /** @type {never} */ (0);
  }
  return id;
}

/**
 * Basename-only asset names for upload URLs / gh --input (no path separators).
 * @param {unknown} fileName
 * @returns {string}
 */
export function assertSafeReleaseAssetName(fileName) {
  if (
    typeof fileName !== 'string' ||
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    /[\\/]/.test(fileName) ||
    // eslint-disable-next-line no-control-regex -- reject ASCII controls in asset names
    /[\x00-\x1F\x7F]/.test(fileName)
  ) {
    fail(`Unsafe release asset name: ${JSON.stringify(fileName)}`);
    return /** @type {never} */ ('');
  }
  return fileName;
}

/**
 * Ensure a disk upload path is a readable regular file whose basename matches `fileName`.
 * Call before deleting a prior release asset so a missing path cannot orphan the old asset.
 * @param {unknown} filePath
 * @param {string} fileName already validated via assertSafeReleaseAssetName
 * @returns {string}
 */
export function assertReadableReleaseUploadFile(filePath, fileName) {
  const name = assertSafeReleaseAssetName(fileName);
  if (typeof filePath !== 'string' || !filePath) {
    fail(`Upload file path is required for asset ${name}`);
    return /** @type {never} */ ('');
  }
  if (path.basename(filePath) !== name) {
    fail(`Asset name ${JSON.stringify(name)} must match basename of ${JSON.stringify(filePath)}`);
    return /** @type {never} */ ('');
  }
  try {
    const st = statSync(filePath);
    if (!st.isFile()) {
      fail(`Upload path is not a regular file: ${JSON.stringify(filePath)}`);
      return /** @type {never} */ ('');
    }
  } catch {
    fail(`Upload file not readable for asset ${name}: ${JSON.stringify(filePath)}`);
    return /** @type {never} */ ('');
  }
  return filePath;
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
    const matches = await listReleasesForTag(tag, token);
    const existingDraft = matches.find((release) => release.draft === true);
    if (existingDraft) {
      return existingDraft;
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

/**
 * PATCH release metadata, returning null on failure instead of exiting.
 * Used after asset consolidation so a metadata 403 cannot undo a successful merge.
 *
 * Do not send `target_commitish` here: Actions `GITHUB_TOKEN` cannot retarget a release
 * when the commit differs in `.github/workflows/` from the default branch (HTTP 403
 * "Resource not accessible by integration"). The git tag already pins the SHA.
 */
export async function patchReleaseMetadataBestEffort(releaseId, token, patch, log = console.debug) {
  if (!patch || Object.keys(patch).length === 0) {
    return null;
  }
  const { response, json } = await githubRequest(`/releases/${releaseId}`, {
    token,
    method: 'PATCH',
    body: patch,
  });
  if (response.ok) {
    return json;
  }
  // Only HTTP 403 is non-fatal after assets are merged (GITHUB_TOKEN cannot retarget
  // across workflow diffs). Other statuses still fail the job for investigation.
  if (response.status === 403) {
    log(
      `[github-release] PATCH release ${releaseId} failed (403): ` +
        `${json?.message ?? response.statusText} — leaving metadata unchanged after asset merge`,
    );
    return null;
  }
  fail(
    `PATCH release ${releaseId} failed (${response.status}): ${json?.message ?? response.statusText}`,
  );
  return null;
}

export async function getRelease(releaseId, token) {
  const { response, json } = await githubRequest(`/releases/${releaseId}`, { token });
  if (!response.ok) {
    fail(
      `GET release ${releaseId} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }
  return json;
}

export async function uploadReleaseAsset(
  releaseId,
  fileName,
  bytes,
  token,
  { throwOnError = false } = {},
) {
  const id = trustedGithubReleaseId(releaseId);
  const name = assertSafeReleaseAssetName(fileName);
  const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${id}/assets?name=${encodeURIComponent(name)}`;
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
    const message = `Upload asset ${name} to release ${id} failed (${response.status}): ${json?.message ?? response.statusText}`;
    if (throwOnError) {
      throw new Error(message);
    }
    fail(message);
  }

  return json;
}

/**
 * Upload a local file via `gh api --input` so JS never joins readFile → fetch
 * (CodeQL `js/file-access-to-http`). Used by CI packaging uploads; consolidate still
 * uses in-memory bytes from `downloadReleaseAsset` (network → network).
 *
 * @param {number | string} releaseId
 * @param {string} fileName
 * @param {string} filePath
 * @param {string} token
 * @param {{ execFileSync?: typeof execFileSync, throwOnError?: boolean }} [opts]
 */
export function uploadReleaseAssetFromFile(
  releaseId,
  fileName,
  filePath,
  token,
  { execFileSync: execFile = execFileSync, throwOnError = false } = {},
) {
  const id = trustedGithubReleaseId(releaseId);
  const name = assertSafeReleaseAssetName(fileName);
  assertReadableReleaseUploadFile(filePath, name);

  const uploadUrl = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${id}/assets?name=${encodeURIComponent(name)}`;
  let stdout;
  try {
    stdout = execFile(
      'gh',
      [
        'api',
        '--method',
        'POST',
        '-H',
        'Accept: application/vnd.github+json',
        '-H',
        'Content-Type: application/octet-stream',
        '-H',
        'X-GitHub-Api-Version: 2022-11-28',
        uploadUrl,
        '--input',
        filePath,
      ],
      {
        env: { ...process.env, GH_TOKEN: token, GITHUB_TOKEN: token },
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `Upload asset ${name} to release ${id} failed: ${detail}`;
    if (throwOnError) {
      throw new Error(message, { cause: error });
    }
    fail(message);
    return /** @type {never} */ (undefined);
  }

  if (typeof stdout === 'string' && stdout.trim()) {
    try {
      return JSON.parse(stdout);
    } catch {
      return { name };
    }
  }
  return { name };
}

/**
 * Upload (or replace) a single asset on an existing release. Never creates a release.
 * Prefer `filePath` for disk uploads (CodeQL); use `bytes` for in-memory consolidate moves.
 *
 * When replacing, the prior asset bytes are cached before delete. If the replacement
 * upload fails, those bytes are re-uploaded (best-effort restore). Failure point: if
 * both replacement and restore fail, the prior asset is gone — job exits non-zero.
 *
 * @param {{
 *   releaseId: number | string,
 *   token: string,
 *   fileName: string,
 *   bytes?: Uint8Array,
 *   filePath?: string,
 *   existingAssets?: Array<{ id: number, name: string }>,
 *   log?: (...args: unknown[]) => void,
 *   uploadFromFile?: typeof uploadReleaseAssetFromFile,
 *   downloadAsset?: typeof downloadReleaseAsset,
 *   uploadBytes?: typeof uploadReleaseAsset,
 *   deleteAsset?: typeof deleteReleaseAsset,
 *   getReleaseById?: typeof getRelease,
 * }} opts
 */
export async function uploadOrReplaceReleaseAsset({
  releaseId,
  token,
  fileName,
  bytes,
  filePath,
  existingAssets,
  log = console.debug,
  uploadFromFile = uploadReleaseAssetFromFile,
  downloadAsset = downloadReleaseAsset,
  uploadBytes = uploadReleaseAsset,
  deleteAsset = deleteReleaseAsset,
  getReleaseById = getRelease,
}) {
  const id = trustedGithubReleaseId(releaseId);
  const name = assertSafeReleaseAssetName(fileName);
  const usePath = typeof filePath === 'string' && filePath !== '';

  // Validate path (or require bytes) before any delete so a missing file cannot
  // remove the existing release asset.
  if (usePath) {
    assertReadableReleaseUploadFile(filePath, name);
  } else if (bytes == null) {
    fail(`Upload asset ${name}: bytes or filePath required`);
  }

  const assets = existingAssets ?? (await getReleaseById(id, token)).assets ?? [];
  const prior = assets.find((asset) => asset.name === name);

  /** @type {Uint8Array | null} */
  let priorBytes = null;
  if (prior) {
    priorBytes = await downloadAsset(prior.id, token);
    log(`[github-release] Replacing existing asset ${name} on release ${id}`);
    await deleteAsset(prior.id, token);
  }

  try {
    if (usePath) {
      return uploadFromFile(id, name, /** @type {string} */ (filePath), token, {
        throwOnError: true,
      });
    }
    return await uploadBytes(id, name, /** @type {Uint8Array} */ (bytes), token, {
      throwOnError: true,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (priorBytes) {
      try {
        await uploadBytes(id, name, priorBytes, token, { throwOnError: true });
        log(`[github-release] Restored prior asset ${name} on release ${id} after upload failure`);
      } catch (restoreError) {
        const restoreDetail =
          restoreError instanceof Error ? restoreError.message : String(restoreError);
        // Failure point: replacement upload failed and restore failed — prior asset gone.
        fail(
          `Upload asset ${name} to release ${id} failed (${detail}); restore of prior asset also failed (${restoreDetail})`,
        );
      }
    }
    fail(`Upload asset ${name} to release ${id} failed: ${detail}`);
  }
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

/**
 * @param {{
 *   tag: string,
 *   token: string,
 *   targetCommitish?: string,
 *   log?: (...args: unknown[]) => void,
 * }} opts
 * `targetCommitish` is accepted for call-site compatibility but never PATCHed
 * (GITHUB_TOKEN 403 — see patchReleaseMetadataBestEffort).
 */
export async function consolidateReleases({ tag, token, log = console.debug }) {
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
  if (bestBody && bestBody !== keeper.body) {
    patch.body = bestBody;
  }

  const updated = await patchReleaseMetadataBestEffort(keeper.id, token, patch, log);
  const result = updated ?? keeper;
  log(
    `[github-release] Consolidated ${tag} — release ${result.id} has ${result.assets?.length ?? keeperAssetNames.size} assets (moved ${moved})`,
  );
  return result;
}

/**
 * Ensure at most one draft release exists for a tag. Merges split assets when parallel
 * publish jobs forked duplicate drafts (including untagged-e* names matched by release name).
 *
 * @param {string} tag
 * @param {string} token
 * @param {{
 *   targetCommitish?: string,
 *   log?: (...args: unknown[]) => void,
 * }} [opts]
 * `targetCommitish` is accepted for call-site compatibility but never PATCHed
 * (GITHUB_TOKEN 403 — see patchReleaseMetadataBestEffort).
 */
export async function normalizeDraftReleasesForTag(tag, token, { log = console.debug } = {}) {
  const releases = await listReleasesForTag(tag, token);
  if (releases.length === 0) {
    return null;
  }

  if (releases.length > 1) {
    return consolidateReleases({ tag, token, log });
  }

  const release = releases[0];
  const patch = {};
  if (release.tag_name !== tag) {
    patch.tag_name = tag;
    patch.name = versionFromTag(tag);
    patch.draft = true;
  }
  if (Object.keys(patch).length === 0) {
    return release;
  }

  const updated = await patchReleaseMetadataBestEffort(release.id, token, patch, log);
  if (!updated) {
    return release;
  }
  log(`[github-release] Repaired release ${updated.id} metadata for ${tag}`);
  return updated;
}

/**
 * @param {{
 *   tag: string,
 *   token: string,
 *   targetCommitish?: string,
 *   allowCreate?: boolean,
 *   log?: (...args: unknown[]) => void,
 * }} opts
 * Create only when `allowCreate` is true (prepare job sets MESH_CLIENT_ALLOW_DRAFT_CREATE=1).
 * Upload jobs must reuse the prepare draft and never POST /releases.
 */
export async function ensureGithubDraftRelease({
  tag,
  token,
  targetCommitish,
  allowCreate = false,
  log = console.debug,
}) {
  let keeper = await normalizeDraftReleasesForTag(tag, token, { log });
  // Only reuse an existing *draft*. A published release for the same tag must not be
  // treated as the CI upload target (schema-note patches and artifact uploads are draft-only).
  if (keeper?.draft === true) {
    log(`[ci-ensure-github-draft-release] Using release ${keeper.id} for ${tag}`);
    return keeper;
  }

  if (!allowCreate) {
    fail(
      `No draft release for ${tag}. prepare-github-release must create it first ` +
        `(set MESH_CLIENT_ALLOW_DRAFT_CREATE=1 only in that job).`,
    );
    return /** @type {never} */ (undefined);
  }

  keeper = await createDraftRelease(tag, token, targetCommitish);
  log(`[ci-ensure-github-draft-release] Created draft release ${keeper.id} for ${tag}`);
  return keeper;
}

/**
 * Poll until a draft exists for the tag (Flatpak may start before Electron prepare finishes).
 * @param {{
 *   tag: string,
 *   token: string,
 *   attempts?: number,
 *   delayMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   log?: (...args: unknown[]) => void,
 * }} opts
 */
export async function waitForGithubDraftRelease({
  tag,
  token,
  attempts = 30,
  delayMs = 10_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.debug,
}) {
  assertSafeReleaseTag(tag);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const releases = await listReleasesForTag(tag, token);
    const draft = releases.find((release) => release.draft === true);
    if (draft) {
      log(
        `[github-release] Found draft release ${draft.id} for ${tag} (attempt ${attempt}/${attempts})`,
      );
      return draft;
    }
    if (attempt < attempts) {
      log(
        `[github-release] No draft for ${tag} yet (attempt ${attempt}/${attempts}); waiting ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }
  fail(`Timed out waiting for draft release ${tag} after ${attempts} attempts`);
}
