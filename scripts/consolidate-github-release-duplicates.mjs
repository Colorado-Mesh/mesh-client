#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  API_ROOT,
  authToken,
  deleteRelease,
  deleteReleaseAsset,
  fail,
  listReleasesForTag,
  patchRelease,
  pickCanonicalRelease,
  resolveTag,
  resolveTargetCommitish,
  uploadReleaseAsset,
  versionFromTag,
} from './github-release-api.mjs';

async function downloadAsset(assetId, token) {
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

async function consolidateReleases({ tag, token, log = console.debug }) {
  const releases = await listReleasesForTag(tag, token);
  if (releases.length === 0) {
    fail(`No releases found for ${tag}`);
  }
  if (releases.length === 1) {
    log(`[consolidate-github-release] Single release ${releases[0].id} — nothing to merge`);
    return releases[0];
  }

  const keeper = pickCanonicalRelease(releases);
  const keeperAssetNames = new Set((keeper.assets ?? []).map((asset) => asset.name));
  let bestBody = keeper.body ?? '';
  let moved = 0;

  log(
    `[consolidate-github-release] Canonical release ${keeper.id} (${keeperAssetNames.size} assets); ` +
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
          `[consolidate-github-release] Skipping duplicate asset name ${asset.name} on ${release.id}`,
        );
        await deleteReleaseAsset(asset.id, token);
        continue;
      }

      log(
        `[consolidate-github-release] Moving ${asset.name} from release ${release.id} → ${keeper.id}`,
      );
      const bytes = await downloadAsset(asset.id, token);
      await uploadReleaseAsset(keeper.id, asset.name, bytes, token);
      await deleteReleaseAsset(asset.id, token);
      keeperAssetNames.add(asset.name);
      moved += 1;
    }

    await deleteRelease(release.id, token);
    log(`[consolidate-github-release] Deleted duplicate release ${release.id}`);
  }

  const patch = {
    tag_name: tag,
    name: versionFromTag(tag),
    draft: true,
  };
  const targetCommitish = resolveTargetCommitish(process.env);
  if (targetCommitish) {
    patch.target_commitish = targetCommitish;
  }
  if (bestBody && bestBody !== keeper.body) {
    patch.body = bestBody;
  }

  const updated = await patchRelease(keeper.id, token, patch);
  log(
    `[consolidate-github-release] Done — release ${updated.id} has ${updated.assets?.length ?? keeperAssetNames.size} assets ` +
      `(moved ${moved})`,
  );
  return updated;
}

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  const release = await consolidateReleases({ tag, token, log: console.debug });
  console.debug(
    `[consolidate-github-release] https://github.com/Colorado-Mesh/mesh-client/releases/tag/${release.tag_name}`,
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Unexpected error: ${detail}`);
  });
}

export { consolidateReleases };
