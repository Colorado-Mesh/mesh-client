#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  authToken,
  ensureGithubDraftRelease,
  resolveTag,
  resolveTargetCommitish,
} from './github-release-api.mjs';

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  await ensureGithubDraftRelease({
    tag,
    token,
    targetCommitish: resolveTargetCommitish(process.env),
  });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-ensure-github-draft-release] Unexpected error: ${detail}`);
    process.exit(1);
  });
}
