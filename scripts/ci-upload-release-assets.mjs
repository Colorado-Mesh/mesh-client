#!/usr/bin/env node
/**
 * Upload local files to an existing GitHub release by id.
 * Never creates a release (prevents duplicate draft forks from electron-builder / softprops).
 *
 * Files are passed as paths into `gh api --input` (via uploadOrReplaceReleaseAsset) so this
 * process never joins readFile → fetch (CodeQL `js/file-access-to-http`).
 */
import { globSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertReadableReleaseUploadFile,
  assertSafeReleaseAssetName,
  authToken,
  fail,
  getRelease,
  trustedGithubReleaseId,
  uploadOrReplaceReleaseAsset,
} from './github-release-api.mjs';

/**
 * @param {string | undefined} raw
 */
export function parseReleaseId(raw) {
  return trustedGithubReleaseId(raw);
}

/**
 * Expand CLI args (paths or globs) to unique regular files.
 * @param {string[]} patterns
 * @param {string} [cwd]
 */
export function resolveUploadFiles(patterns, cwd = process.cwd()) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    fail('Usage: ci-upload-release-assets.mjs <file-or-glob>...');
  }
  /** @type {Set<string>} */
  const files = new Set();
  for (const pattern of patterns) {
    const matches = globSync(pattern, {
      cwd,
      absolute: true,
      nodir: true,
      dot: false,
    });
    if (matches.length === 0) {
      const abs = path.resolve(cwd, pattern);
      try {
        if (statSync(abs).isFile()) {
          files.add(abs);
        }
      } catch {
        // catch-no-log-ok optional glob with no matches — skip
      }
      continue;
    }
    for (const match of matches) {
      files.add(match);
    }
  }
  if (files.size === 0) {
    fail(`No files matched upload patterns: ${patterns.join(' ')}`);
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {string[]} files
 * @returns {string[]}
 */
export function findDuplicateBasenames(files) {
  /** @type {Map<string, string[]>} */
  const byBase = new Map();
  for (const filePath of files) {
    const base = path.basename(filePath);
    const list = byBase.get(base) ?? [];
    list.push(filePath);
    byBase.set(base, list);
  }
  return [...byBase.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([base]) => base)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * @param {{
 *   releaseId: number | string,
 *   token: string,
 *   files: string[],
 *   get?: typeof getRelease,
 *   upload?: typeof uploadOrReplaceReleaseAsset,
 *   log?: (...args: unknown[]) => void,
 * }} opts
 */
export async function uploadReleaseAssets(opts) {
  const get = opts.get ?? getRelease;
  const upload = opts.upload ?? uploadOrReplaceReleaseAsset;
  const log = opts.log ?? console.debug;
  const releaseId = trustedGithubReleaseId(opts.releaseId);

  const release = await get(releaseId, opts.token);
  if (release.draft !== true) {
    fail(`Release ${releaseId} is not a draft; refusing to upload`);
    return 0;
  }

  const duplicates = findDuplicateBasenames(opts.files);
  if (duplicates.length > 0) {
    fail(`Duplicate basename(s) in upload set (refusing to upload): ${duplicates.join(', ')}`);
    return 0;
  }

  /** @type {Array<{ id: number, name: string }>} */
  let existingAssets = [...(release.assets ?? [])];
  let uploaded = 0;

  for (const filePath of opts.files) {
    const fileName = assertSafeReleaseAssetName(path.basename(filePath));
    // Validate readability before upload/replace can delete a prior asset.
    assertReadableReleaseUploadFile(filePath, fileName);
    log(`[ci-upload-release-assets] Uploading ${fileName} → release ${releaseId}`);
    await upload({
      releaseId,
      token: opts.token,
      fileName,
      filePath,
      existingAssets,
      log,
    });
    existingAssets = existingAssets.filter((asset) => asset.name !== fileName);
    existingAssets.push({ id: -1, name: fileName });
    uploaded += 1;
  }

  log(`[ci-upload-release-assets] Uploaded ${uploaded} asset(s) to release ${releaseId}`);
  return uploaded;
}

async function main() {
  const releaseId = parseReleaseId(process.env.RELEASE_ID);
  const token = authToken(process.env);
  const files = resolveUploadFiles(process.argv.slice(2));
  await uploadReleaseAssets({ releaseId, token, files });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-upload-release-assets] ${detail}`);
    process.exit(1);
  });
}
