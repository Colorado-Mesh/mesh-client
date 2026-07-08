#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  authToken,
  consolidateReleases,
  fail,
  resolveTag,
  resolveTargetCommitish,
} from './github-release-api.mjs';

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  const release = await consolidateReleases({
    tag,
    token,
    targetCommitish: resolveTargetCommitish(process.env),
    log: console.debug,
  });
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
