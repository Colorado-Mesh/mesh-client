#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  authToken,
  ensureGithubDraftRelease,
  resolveTag,
  resolveTargetCommitish,
} from './github-release-api.mjs';

/**
 * @param {string | undefined} githubOutput
 * @param {number | string} releaseId
 */
export function writeReleaseIdOutput(githubOutput, releaseId) {
  if (typeof githubOutput !== 'string' || !githubOutput) {
    return;
  }
  appendFileSync(githubOutput, `release_id=${releaseId}\n`, 'utf8');
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
  console.debug(`[ci-ensure-github-draft-release] release_id=${release.id}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-ensure-github-draft-release] Unexpected error: ${detail}`);
    process.exit(1);
  });
}
