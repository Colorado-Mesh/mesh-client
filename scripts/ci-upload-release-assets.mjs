#!/usr/bin/env node
/**
 * Upload local files to an existing GitHub release by id.
 * Never creates a release (prevents duplicate draft forks from electron-builder / softprops).
 */
import { readFileSync, globSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { authToken, fail, getRelease, uploadOrReplaceReleaseAsset } from './github-release-api.mjs';

/**
 * @param {string | undefined} raw
 */
export function parseReleaseId(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    fail(`RELEASE_ID must be a numeric GitHub release id (got ${JSON.stringify(raw)})`);
  }
  return Number(raw);
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
          continue;
        }
      } catch {
        // catch-no-log-ok missing path checked below via empty matches
      }
      fail(`No files matched upload pattern: ${pattern}`);
    }
    for (const match of matches) {
      files.add(match);
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {{
 *   releaseId: number,
 *   token: string,
 *   files: string[],
 *   get?: typeof getRelease,
 *   upload?: typeof uploadOrReplaceReleaseAsset,
 *   readFile?: (path: string) => Uint8Array,
 *   log?: (...args: unknown[]) => void,
 * }} opts
 */
export async function uploadReleaseAssets(opts) {
  const get = opts.get ?? getRelease;
  const upload = opts.upload ?? uploadOrReplaceReleaseAsset;
  const readFile = opts.readFile ?? ((filePath) => new Uint8Array(readFileSync(filePath)));
  const log = opts.log ?? console.debug;

  const release = await get(opts.releaseId, opts.token);
  if (release.draft !== true) {
    fail(`Release ${opts.releaseId} is not a draft; refusing to upload`);
    return 0;
  }

  /** @type {Array<{ id: number, name: string }>} */
  let existingAssets = [...(release.assets ?? [])];
  let uploaded = 0;

  for (const filePath of opts.files) {
    const fileName = path.basename(filePath);
    const bytes = readFile(filePath);
    log(
      `[ci-upload-release-assets] Uploading ${fileName} (${bytes.byteLength} bytes) → release ${opts.releaseId}`,
    );
    await upload({
      releaseId: opts.releaseId,
      token: opts.token,
      fileName,
      bytes,
      existingAssets,
      log,
    });
    existingAssets = existingAssets.filter((asset) => asset.name !== fileName);
    existingAssets.push({ id: -1, name: fileName });
    uploaded += 1;
  }

  log(`[ci-upload-release-assets] Uploaded ${uploaded} asset(s) to release ${opts.releaseId}`);
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
