#!/usr/bin/env node
/**
 * Repair a published GitHub release whose tag_name is still `untagged-*`.
 *
 * Usage:
 *   GH_TOKEN=<admin PAT> node scripts/repair-published-release-tag.mjs --tag v5.30.0
 */
import { pathToFileURL } from 'node:url';

import {
  authToken,
  fail,
  getRelease,
  listReleasesForTag,
  patchReleaseTagMetadataRequired,
  resolveTag,
} from './github-release-api.mjs';
import { isUntaggedPlaceholderTag } from './github-release-version.mjs';

/**
 * @param {string} tag
 * @param {string} token
 * @param {string} [fallbackToken]
 */
export async function repairPublishedReleaseTag(tag, token, fallbackToken) {
  const releases = await listReleasesForTag(tag, token);
  if (releases.length === 0) {
    fail(`No GitHub release found for ${tag}`);
  }
  const broken = releases.find(
    (release) =>
      release.draft !== true &&
      isUntaggedPlaceholderTag(release.tag_name) &&
      release.tag_name !== tag,
  );
  const target = broken ?? releases.find((release) => release.tag_name !== tag);
  if (!target) {
    console.debug(`[repair-published-release-tag] ${tag} already has correct tag_name`);
    return getRelease(target?.id ?? releases[0].id, token);
  }
  console.debug(
    `[repair-published-release-tag] Repairing release ${target.id} (${String(target.tag_name)} → ${tag})`,
  );
  return patchReleaseTagMetadataRequired(target.id, tag, token, { fallbackToken });
}

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  const fallbackToken = process.env.RELEASE_PUSH_TOKEN;
  const release = await repairPublishedReleaseTag(tag, token, fallbackToken);
  console.debug(
    `[repair-published-release-tag] OK release ${release.id} tag_name=${release.tag_name}`,
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Unexpected error: ${detail}`);
  });
}
