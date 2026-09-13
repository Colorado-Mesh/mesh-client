#!/usr/bin/env node
/**
 * Fail closed when a GitHub release's latest*.yml files[].url entries are not
 * exact asset names on that release (the v5.36.0 Windows 404: yml hyphenated,
 * GitHub stored dotted names).
 *
 * Network I/O stays in main(); helpers are pure for unit tests.
 */
import { pathToFileURL } from 'node:url';

import {
  parseElectronUpdateYml,
  UPDATE_YML_CHANNEL_FILES,
} from './assert-update-yml-artifacts.mjs';
import {
  authToken,
  fail,
  getRelease,
  listReleasesForTag,
  resolveTag,
  trustedGithubReleaseId,
} from './github-release-api.mjs';

/**
 * @param {string} ymlName
 * @param {string} ymlText
 * @param {string[]} assetNames
 * @returns {{ yml: string, urls: string[] }}
 */
export function assertYmlUrlsAreReleaseAssets(ymlName, ymlText, assetNames) {
  const assetSet = new Set(assetNames);
  const parsed = parseElectronUpdateYml(ymlText);
  if (parsed.urls.length === 0) {
    throw new Error(`${ymlName} has no files[].url or path entries`);
  }
  /** @type {string[]} */
  const missing = [];
  for (const url of parsed.urls) {
    if (url.includes(' ')) {
      throw new Error(
        `${ymlName} url ${JSON.stringify(url)} contains spaces — GitHub rewrites spaces to dots`,
      );
    }
    if (!assetSet.has(url)) {
      missing.push(url);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${ymlName} urls not present as release assets: ${missing.join(', ')} (assets: ${assetNames.join(', ') || '(none)'})`,
    );
  }
  return { yml: ymlName, urls: parsed.urls };
}

/**
 * @param {Array<{ name?: unknown }>} assets
 * @returns {string[]}
 */
export function collectReleaseAssetNames(assets) {
  return (assets ?? [])
    .map((asset) => (typeof asset.name === 'string' ? asset.name : ''))
    .filter(Boolean);
}

/**
 * @param {Record<string, string>} ymlByName
 * @param {string[]} assetNames
 * @returns {{ checked: string[] }}
 */
export function assertAllChannelYmlUrlsAreReleaseAssets(ymlByName, assetNames) {
  const names = Object.keys(ymlByName);
  if (names.length === 0) {
    throw new Error(
      `No update channel yml assets on release (expected one of ${UPDATE_YML_CHANNEL_FILES.join(', ')})`,
    );
  }
  for (const name of names) {
    assertYmlUrlsAreReleaseAssets(name, ymlByName[name], assetNames);
  }
  return { checked: names };
}

/**
 * @param {string} tag
 * @param {string} token
 * @param {number | null} releaseId
 */
export async function resolveReleaseForUpdateYmlAssert(tag, token, releaseId) {
  if (releaseId != null) {
    return getRelease(releaseId, token);
  }
  const matches = await listReleasesForTag(tag, token);
  const draft = matches.find((release) => release.draft === true);
  if (draft) return draft;
  if (matches[0]) return matches[0];
  fail(`No GitHub release found for ${tag}`);
  return /** @type {never} */ (null);
}

/**
 * @param {string} assetApiUrl
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function downloadReleaseAssetText(assetApiUrl, token) {
  if (
    typeof assetApiUrl !== 'string' ||
    !/^https:\/\/api\.github\.com\/repos\/Colorado-Mesh\/mesh-client\/releases\/assets\/\d+$/.test(
      assetApiUrl,
    )
  ) {
    throw new Error(`Unexpected release asset URL: ${String(assetApiUrl)}`);
  }
  const response = await fetch(assetApiUrl, {
    headers: {
      Accept: 'application/octet-stream',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`Download release asset failed (${response.status}): ${assetApiUrl}`);
  }
  return response.text();
}

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  const releaseIdRaw = process.env.RELEASE_ID;
  const releaseId =
    typeof releaseIdRaw === 'string' && releaseIdRaw ? trustedGithubReleaseId(releaseIdRaw) : null;
  const release = await resolveReleaseForUpdateYmlAssert(tag, token, releaseId);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const assetNames = collectReleaseAssetNames(assets);
  /** @type {Record<string, string>} */
  const ymlByName = {};
  for (const asset of assets) {
    if (typeof asset?.name !== 'string' || !UPDATE_YML_CHANNEL_FILES.includes(asset.name)) {
      continue;
    }
    if (typeof asset.url !== 'string') {
      throw new Error(`Release asset ${asset.name} is missing an API url`);
    }
    ymlByName[asset.name] = await downloadReleaseAssetText(asset.url, token);
  }
  const result = assertAllChannelYmlUrlsAreReleaseAssets(ymlByName, assetNames);
  console.debug(
    `[assert-github-release-update-yml] OK — ${result.checked.join(', ')} match release assets`,
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Unexpected error: ${detail}`);
  });
}
