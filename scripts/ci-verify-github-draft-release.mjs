#!/usr/bin/env node
/**
 * Fail CI when a draft release still has `untagged-*` tag_name after consolidation,
 * or when any matching release for the version is still on an untagged placeholder.
 *
 * Env: RELEASE_TAG, optional RELEASE_ID, GH_TOKEN
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  authToken,
  fail,
  getRelease,
  listReleasesForTag,
  resolveTag,
  trustedGithubReleaseId,
} from './github-release-api.mjs';
import { isUntaggedPlaceholderTag } from './github-release-version.mjs';

/**
 * @param {{ tag_name?: unknown, draft?: unknown }} release
 * @param {string} expectedTag
 */
export function verifyDraftReleaseTag(release, expectedTag) {
  if (!release || release.draft !== true) {
    return {
      ok: false,
      message: `Release is not a draft (tag_name=${JSON.stringify(release?.tag_name)})`,
    };
  }
  if (release.tag_name !== expectedTag) {
    const untagged =
      isUntaggedPlaceholderTag(release.tag_name) ||
      release.tag_name == null ||
      release.tag_name === '';
    return {
      ok: false,
      message: untagged
        ? `tag_name is still ${JSON.stringify(release.tag_name)} — expected ${expectedTag}. Do NOT publish. Run scripts/repair-published-release-tag.mjs if already published.`
        : `tag_name ${JSON.stringify(release.tag_name)} does not match expected ${expectedTag}`,
    };
  }
  return { ok: true, message: `Draft release tag_name is ${expectedTag}` };
}

/**
 * Fail when any release matching the version still has an `untagged-*` tag_name.
 * @param {Array<{ id?: unknown, tag_name?: unknown }>} releases
 * @param {string} expectedTag
 */
export function verifyNoUntaggedMatchingReleases(releases, expectedTag) {
  const untagged = (releases ?? []).filter((release) =>
    isUntaggedPlaceholderTag(release?.tag_name),
  );
  if (untagged.length === 0) {
    return {
      ok: true,
      message: `No untagged-* releases match ${expectedTag}`,
    };
  }
  const detail = untagged
    .map((release) => `id=${release.id} tag_name=${JSON.stringify(release.tag_name)}`)
    .join('; ');
  return {
    ok: false,
    message:
      `Found ${untagged.length} matching release(s) still on untagged-* (${detail}). ` +
      `Do NOT publish until consolidate/repair leaves only ${expectedTag}.`,
  };
}

/**
 * @param {string | undefined} githubOutput
 * @param {boolean} ok
 */
export function writeVerifyOutput(githubOutput, ok) {
  if (typeof githubOutput !== 'string' || !githubOutput) {
    return;
  }
  appendFileSync(githubOutput, `release_tag_verified=${ok ? 'true' : 'false'}\n`, 'utf8');
}

/**
 * @param {string} tag
 * @param {string} token
 * @param {number | null} releaseId
 */
export async function resolveDraftReleaseForVerify(tag, token, releaseId) {
  if (releaseId != null) {
    const byId = await getRelease(releaseId, token);
    if (byId.draft === true) {
      return byId;
    }
  }
  const matches = await listReleasesForTag(tag, token);
  const draft = matches.find((release) => release.draft === true);
  if (!draft) {
    fail(`No draft release found for ${tag} after consolidation`);
  }
  return draft;
}

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  const releaseIdRaw = process.env.RELEASE_ID;
  const releaseId =
    typeof releaseIdRaw === 'string' && releaseIdRaw ? trustedGithubReleaseId(releaseIdRaw) : null;
  const release = await resolveDraftReleaseForVerify(tag, token, releaseId);
  const result = verifyDraftReleaseTag(release, tag);
  if (!result.ok) {
    writeVerifyOutput(process.env.GITHUB_OUTPUT, false);
    console.error(`::error::${result.message}`);
    fail(result.message);
  }

  const matches = await listReleasesForTag(tag, token);
  const inventory = verifyNoUntaggedMatchingReleases(matches, tag);
  writeVerifyOutput(process.env.GITHUB_OUTPUT, inventory.ok);
  if (!inventory.ok) {
    console.error(`::error::${inventory.message}`);
    fail(inventory.message);
  }

  console.debug(`[ci-verify-github-draft-release] ${result.message}`);
  console.debug(`[ci-verify-github-draft-release] ${inventory.message}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Unexpected error: ${detail}`);
  });
}
