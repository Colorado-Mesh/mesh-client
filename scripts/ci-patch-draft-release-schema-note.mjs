#!/usr/bin/env node
/**
 * Prepend schema-compare markdown to an existing draft GitHub release body.
 */
import { pathToFileURL } from 'node:url';
import {
  authToken,
  ensureGithubDraftRelease,
  listReleasesForTag,
  patchRelease,
  resolveTag,
  resolveTargetCommitish,
} from './github-release-api.mjs';

const SCHEMA_MARKER = '<!-- mesh-client-schema-compare -->';

/**
 * @param {string} existingBody
 * @param {string} schemaMarkdown
 */
export function mergeSchemaNoteIntoReleaseBody(existingBody, schemaMarkdown) {
  const note = `${SCHEMA_MARKER}\n${schemaMarkdown.trim()}\n${SCHEMA_MARKER}`;
  const without = existingBody.replace(
    new RegExp(`${SCHEMA_MARKER}[\\s\\S]*?${SCHEMA_MARKER}\\n?`, 'g'),
    '',
  );
  const rest = without.trim();
  return rest ? `${note}\n\n${rest}\n` : `${note}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf('--markdown-file');
  if (fileIdx < 0 || !argv[fileIdx + 1]) {
    throw new Error('Usage: ci-patch-draft-release-schema-note.mjs --markdown-file <path>');
  }
  const fs = await import('node:fs');
  const markdown = fs.readFileSync(argv[fileIdx + 1], 'utf8');

  const tag = resolveTag(argv, process.env);
  const token = authToken(process.env);
  await ensureGithubDraftRelease({
    tag,
    token,
    targetCommitish: resolveTargetCommitish(process.env),
  });
  const releases = await listReleasesForTag(tag, token);
  const draft = releases.find((r) => r.draft === true) ?? releases[0];
  if (!draft) {
    throw new Error(`No release found for ${tag}`);
  }
  const body = mergeSchemaNoteIntoReleaseBody(draft.body ?? '', markdown);
  await patchRelease(draft.id, token, { body });
  console.log(`[ci-patch-draft-release-schema-note] Updated draft body for ${tag}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-patch-draft-release-schema-note] ${detail}`);
    process.exit(1);
  });
}
