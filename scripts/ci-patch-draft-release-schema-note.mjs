#!/usr/bin/env node
/**
 * Prepend schema-compare markdown to an existing draft GitHub release body.
 *
 * Markdown is rebuilt from trusted schema job outputs (env), not read from a
 * downloaded artifact — avoids CodeQL `js/file-access-to-http` (file → GitHub API).
 */
import { pathToFileURL } from 'node:url';
import {
  formatSchemaCompareMarkdown,
  isSchemaBumped,
  trustedReleaseTag,
  trustedSchemaVersion,
} from './ci-schema-release-compare.mjs';
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
 * Rebuild release-mode schema markdown from compare-job outputs (env).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function schemaMarkdownFromCompareOutputs(env = process.env) {
  const currSchema = trustedSchemaVersion(env.MESH_CLIENT_SCHEMA_CURR);
  const prevRaw = env.MESH_CLIENT_SCHEMA_PREV;
  const prevSchema =
    typeof prevRaw === 'string' && prevRaw !== '' && /^\d+$/.test(prevRaw)
      ? trustedSchemaVersion(prevRaw)
      : null;
  const prevTagRaw = env.MESH_CLIENT_SCHEMA_PREV_TAG;
  const prevTag =
    typeof prevTagRaw === 'string' && prevTagRaw !== '' ? trustedReleaseTag(prevTagRaw) : null;
  return formatSchemaCompareMarkdown({
    mode: 'release',
    currSchema,
    prevSchema,
    prevTag,
    schemaBumped: isSchemaBumped(currSchema, prevSchema),
  });
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

  // Prefer the draft returned by ensure (POST/PATCH response). Re-listing immediately
  // after create can miss the draft — GitHub List Releases lags briefly, which caused
  // prepare-github-release to fail with "No release found" right after creating one.
  const ensured = await ensureDraft({
    tag: opts.tag,
    token: opts.token,
    targetCommitish: opts.targetCommitish,
  });
  const draft =
    ensured?.draft === true
      ? ensured
      : requireDraftReleaseForSchemaPatch(await listReleases(opts.tag, opts.token), opts.tag);
  const body = mergeSchemaNoteIntoReleaseBody(draft.body ?? '', opts.markdown);
  await patch(draft.id, opts.token, { body });
  console.debug(`[ci-patch-draft-release-schema-note] Updated draft body for ${opts.tag}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--markdown-file')) {
    throw new Error(
      'Usage: ci-patch-draft-release-schema-note.mjs (pass MESH_CLIENT_SCHEMA_* env from schema-release-compare; --markdown-file removed for CodeQL)',
    );
  }

  const markdown = schemaMarkdownFromCompareOutputs(process.env);
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
