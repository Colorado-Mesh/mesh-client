#!/usr/bin/env node
/**
 * Prepend the release notes, macOS install note and schema-compare markdown to an existing
 * draft GitHub release body.
 *
 * Markdown is rebuilt from trusted schema job outputs (env), not read from a
 * downloaded artifact — avoids CodeQL `js/file-access-to-http` (file → GitHub API).
 * The release notes are the annotated tag's message, read through the GitHub API (the Cut
 * release workflow writes the promotion's notes there), so they also never come from a file.
 */
import { pathToFileURL } from 'node:url';
import { createGithubApi, resolveRepo } from './promotionGithub.mjs';
import {
  formatSchemaCompareMarkdown,
  isSchemaBumped,
  trustedReleaseTag,
  trustedSchemaVersion,
} from './ci-schema-release-compare.mjs';
import {
  formatMacosInstallReleaseMarkdown,
  mergeMacosInstallNoteIntoReleaseBody,
} from './macos-install-notice.mjs';
import {
  authToken,
  draftPlaceholderBody,
  ensureGithubDraftRelease,
  getRelease,
  listReleasesForTag,
  patchRelease,
  resolveTag,
  resolveTargetCommitish,
} from './github-release-api.mjs';

const SCHEMA_MARKER = '<!-- mesh-client-schema-compare -->';
const RELEASE_NOTES_MARKER = '<!-- mesh-client-release-notes -->';

/**
 * @param {string} body
 * @param {string} marker
 * @returns {string} body without any marker-delimited blocks
 */
function removeMarkedBlocks(body, marker) {
  let out = body;
  for (;;) {
    const start = out.indexOf(marker);
    if (start === -1) return out;
    const end = out.indexOf(marker, start + marker.length);
    if (end === -1) return out;
    let stop = end + marker.length;
    if (out[stop] === '\n') stop += 1;
    out = out.slice(0, start) + out.slice(stop);
  }
}

/**
 * Put release notes at the top of a draft body, replacing earlier notes and the draft
 * placeholder line. Blank notes, or the one-line `Release vX.Y.Z` message the emergency
 * `release.sh` path writes, leave the body unchanged.
 * @param {string} existingBody
 * @param {string} notes
 * @param {string} tag
 */
export function mergeReleaseNotesIntoReleaseBody(existingBody, notes, tag) {
  const text = (notes ?? '').trim();
  if (!text || text === `Release ${tag}` || text === `Release ${tag.replace(/^v/, '')}`) {
    return existingBody;
  }
  const placeholder = draftPlaceholderBody(tag);
  const rest = removeMarkedBlocks(existingBody, RELEASE_NOTES_MARKER)
    .split('\n')
    .filter((line) => line.trim() !== placeholder)
    .join('\n')
    .trim();
  const block = `${RELEASE_NOTES_MARKER}\n${text}\n${RELEASE_NOTES_MARKER}`;
  return rest ? `${block}\n\n${rest}\n` : `${block}\n`;
}

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
 * @param {string | undefined} raw
 * @returns {number | undefined}
 */
export function parseOptionalReleaseId(raw) {
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`RELEASE_ID must be numeric (got ${JSON.stringify(raw)})`);
  }
  return Number(raw);
}

/**
 * @param {{
 *   tag: string,
 *   token: string,
 *   markdown: string,
 *   releaseId?: number,
 *   targetCommitish?: string,
 *   ensureDraft?: typeof ensureGithubDraftRelease,
 *   getReleaseById?: typeof getRelease,
 *   listReleases?: typeof listReleasesForTag,
 *   patch?: typeof patchRelease,
 *   fetchTagMessage?: (tag: string) => Promise<string | null>,
 * }} opts
 */
export async function patchDraftReleaseSchemaNote(opts) {
  const ensureDraft = opts.ensureDraft ?? ensureGithubDraftRelease;
  const getReleaseById = opts.getReleaseById ?? getRelease;
  const listReleases = opts.listReleases ?? listReleasesForTag;
  const patch = opts.patch ?? patchRelease;

  /** @type {{ id: number, draft?: boolean, body?: string | null }} */
  let draft;
  if (opts.releaseId != null) {
    // Prefer prepare's release_id — avoids List Releases lag right after create.
    draft = await getReleaseById(opts.releaseId, opts.token);
    if (draft.draft !== true) {
      throw new Error(`Release ${opts.releaseId} for ${opts.tag} is not a draft`);
    }
  } else {
    const ensured = await ensureDraft({
      tag: opts.tag,
      token: opts.token,
      targetCommitish: opts.targetCommitish,
      allowCreate: false,
    });
    draft =
      ensured?.draft === true
        ? ensured
        : requireDraftReleaseForSchemaPatch(await listReleases(opts.tag, opts.token), opts.tag);
  }

  const notes = opts.fetchTagMessage ? await opts.fetchTagMessage(opts.tag) : null;
  const withSchema = mergeSchemaNoteIntoReleaseBody(draft.body ?? '', opts.markdown);
  const withInstall = mergeMacosInstallNoteIntoReleaseBody(
    withSchema,
    formatMacosInstallReleaseMarkdown(),
  );
  // Each merge puts its block first, so the notes go last to end up on top.
  const body = mergeReleaseNotesIntoReleaseBody(withInstall, notes ?? '', opts.tag);
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
  const api = createGithubApi({
    token,
    repo: resolveRepo({ env: process.env, cwd: process.cwd() }),
  });
  await patchDraftReleaseSchemaNote({
    tag,
    token,
    markdown,
    releaseId: parseOptionalReleaseId(process.env.RELEASE_ID),
    targetCommitish: resolveTargetCommitish(process.env),
    fetchTagMessage: (releaseTag) => api.annotatedTagMessage(releaseTag),
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
