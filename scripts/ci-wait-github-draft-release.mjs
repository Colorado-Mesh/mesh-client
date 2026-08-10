#!/usr/bin/env node
/**
 * Wait for prepare-github-release to create the draft, then export release_id.
 * Used by Flatpak publish so it never POSTs a competing draft.
 */
import { pathToFileURL } from 'node:url';
import { writeReleaseIdOutput } from './ci-ensure-github-draft-release.mjs';
import { authToken, resolveTag, waitForGithubDraftRelease } from './github-release-api.mjs';

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  const release = await waitForGithubDraftRelease({ tag, token });
  writeReleaseIdOutput(process.env.GITHUB_OUTPUT, release.id);
  console.debug(`[ci-wait-github-draft-release] release_id=${release.id}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-wait-github-draft-release] ${detail}`);
    process.exit(1);
  });
}
