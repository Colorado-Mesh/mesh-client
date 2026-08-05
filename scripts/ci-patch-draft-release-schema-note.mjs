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

/**
 * Only a draft may receive schema-note patches — never fall back to a published release.
 * @param {Array<{ draft?: boolean }>} releases
 * @param {string} tag
 */
export function requireDraftReleaseForSchemaPatch(releases, tag) {
  const draft = releases.find((r) => r.draft === true);
  if (!draft) {
    throw new Error(`No release found for ${tag}`);
  }
  return draft;
}

/**
 * @param {{
 *   tag: string,
 *   token: string,
 *   markdown: string,
 *   targetCommitish?: string,
 *   ensureDraft?: typeof ensureGithubDraftRelease,
 *   listReleases?: typeof listReleasesForTag,
 *   patch?: typeof patchRelease,
 * }} opts
 */
export async function patchDraftReleaseSchemaNote(opts) {
  const ensureDraft = opts.ensureDraft ?? ensureGithubDraftRelease;
  const listReleases = opts.listReleases ?? listReleasesForTag;
  const patch = opts.patch ?? patchRelease;

  await ensureDraft({
    tag: opts.tag,
    token: opts.token,
    targetCommitish: opts.targetCommitish,
  });
  const releases = await listReleases(opts.tag, opts.token);
  const draft = requireDraftReleaseForSchemaPatch(releases, opts.tag);
  const body = mergeSchemaNoteIntoReleaseBody(draft.body ?? '', opts.markdown);
  await patch(draft.id, opts.token, { body });
  console.debug(`[ci-patch-draft-release-schema-note] Updated draft body for ${opts.tag}`);
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
  await patchDraftReleaseSchemaNote({
    tag,
    token,
    markdown,
    targetCommitish: resolveTargetCommitish(process.env),
  });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-patch-draft-release-schema-note] ${detail}`);
    process.exit(1);
  });
}
