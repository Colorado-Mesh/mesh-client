#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  authToken,
  ensureGithubDraftRelease,
  resolveTag,
  resolveTargetCommitish,
  trustedGithubReleaseId,
} from './github-release-api.mjs';

/**
 * Write prepare/wait `release_id` to GITHUB_OUTPUT.
 * Id is reconstructed from validated digits so network JSON cannot taint the disk write
 * (CodeQL `js/http-to-file-access`).
 * @param {string | undefined} githubOutput
 * @param {number | string} releaseId
 */
export function writeReleaseIdOutput(githubOutput, releaseId) {
  if (typeof githubOutput !== 'string' || !githubOutput) {
    return;
  }
  const id = trustedGithubReleaseId(releaseId);
  appendFileSync(githubOutput, `release_id=${id}\n`, 'utf8');
}

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  const allowCreate = process.env.MESH_CLIENT_ALLOW_DRAFT_CREATE === '1';
  const release = await ensureGithubDraftRelease({
    tag,
    token,
    targetCommitish: resolveTargetCommitish(process.env),
    allowCreate,
  });
  writeReleaseIdOutput(process.env.GITHUB_OUTPUT, release.id);
  console.debug(
    `[ci-ensure-github-draft-release] release_id=${trustedGithubReleaseId(release.id)}`,
  );
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-ensure-github-draft-release] Unexpected error: ${detail}`);
    process.exit(1);
  });
}
