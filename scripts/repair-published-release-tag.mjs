#!/usr/bin/env node
/**
 * Repair a published GitHub release whose tag_name is still `untagged-*`.
 *
 * Usage:
 *   GH_TOKEN=YOUR_ADMIN_PAT node scripts/repair-published-release-tag.mjs --tag v5.30.0
 *   EVENT_TAG=untagged-… EVENT_NAME=5.30.0 node scripts/repair-published-release-tag.mjs --from-event
 */
import { pathToFileURL } from 'node:url';

import {
  authToken,
  fail,
  getRelease,
  listReleasesForTag,
  repairReleaseTagAndCleanupOrphan,
  resolveTag,
  SAFE_RELEASE_TAG_RE,
} from './github-release-api.mjs';
import { isUntaggedPlaceholderTag, SAFE_RELEASE_NAME_RE } from './github-release-version.mjs';

/**
 * Resolve expected vX.Y.Z from workflow_dispatch / release.published fields.
 *
 * @param {unknown} eventTag
 * @param {unknown} eventName
 * @returns {{
 *   ok: true,
 *   tag: string,
 *   fromUntagged?: string,
 * } | {
 *   ok: false,
 *   skip?: boolean,
 *   message: string,
 * }}
 */
export function resolveRepairReleaseTag(eventTag, eventName) {
  const tag = typeof eventTag === 'string' ? eventTag : '';
  if (isUntaggedPlaceholderTag(tag)) {
    const name = typeof eventName === 'string' ? eventName : '';
    if (SAFE_RELEASE_NAME_RE.test(name)) {
      return { ok: true, tag: `v${name}`, fromUntagged: tag };
    }
    return {
      ok: false,
      message: `Published release has untagged tag_name and non-semver name=${name}`,
    };
  }
  if (!SAFE_RELEASE_TAG_RE.test(tag)) {
    return {
      ok: false,
      skip: true,
      message: `Skipping non-semver release tag ${tag}`,
    };
  }
  return { ok: true, tag };
}

/**
 * @param {string} tag
 * @param {string} token
 * @param {string} [fallbackToken]
 */
export async function repairPublishedReleaseTag(tag, token, fallbackToken) {
  const releases = await listReleasesForTag(tag, token);
  const published = releases.filter((release) => release.draft !== true);
  if (published.length === 0) {
    fail(`No published GitHub release found for ${tag}`);
  }

  const broken = published.find(
    (release) => isUntaggedPlaceholderTag(release.tag_name) && release.tag_name !== tag,
  );
  const target = broken ?? published.find((release) => release.tag_name !== tag);
  if (!target) {
    const correct = published.find((release) => release.tag_name === tag);
    if (!correct) {
      fail(`No published GitHub release with tag ${tag}`);
    }
    const fresh = await getRelease(correct.id, token);
    if (fresh.tag_name === tag) {
      console.debug(`[repair-published-release-tag] ${tag} already has correct tag_name`);
      return fresh;
    }
    // List saw the right tag_name; a concurrent Publish may have detached to untagged-*.
    if (isUntaggedPlaceholderTag(fresh.tag_name)) {
      console.debug(
        `[repair-published-release-tag] Repairing release ${fresh.id} (${String(fresh.tag_name)} → ${tag}) after re-fetch`,
      );
      return repairReleaseTagAndCleanupOrphan(fresh, tag, token, { fallbackToken });
    }
    console.debug(
      `[repair-published-release-tag] Skipping PATCH for release ${fresh.id}: expected ${tag} but re-fetch has ${String(fresh.tag_name)}`,
    );
    return fresh;
  }
  console.debug(
    `[repair-published-release-tag] Repairing release ${target.id} (${String(target.tag_name)} → ${tag})`,
  );
  return repairReleaseTagAndCleanupOrphan(target, tag, token, { fallbackToken });
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
export function resolveRepairTagFromArgv(argv, env) {
  if (argv.includes('--from-event')) {
    const resolved = resolveRepairReleaseTag(env.EVENT_TAG, env.EVENT_NAME);
    if (!resolved.ok) {
      return resolved;
    }
    if (resolved.fromUntagged) {
      console.debug(
        `[repair-published-release-tag] Published release is on ${resolved.fromUntagged}; repairing to ${resolved.tag}`,
      );
    }
    return { ok: true, tag: resolved.tag };
  }
  return { ok: true, tag: resolveTag(argv, env) };
}

async function main() {
  const resolved = resolveRepairTagFromArgv(process.argv.slice(2), process.env);
  if (!resolved.ok) {
    if (resolved.skip) {
      console.debug(`[repair-published-release-tag] ${resolved.message}`);
      return;
    }
    fail(resolved.message);
  }
  const token = authToken(process.env);
  const release = await repairPublishedReleaseTag(resolved.tag, token);
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
