#!/usr/bin/env node
/**
 * Compare this tree's CURRENT_SCHEMA_VERSION to the last published GitHub release.
 * Emits markdown for Actions step summaries / READ-ME-FIRST artifacts and optional
 * GITHUB_OUTPUT keys for downstream packaging.
 *
 * Pure helpers are exported for unit tests (no live GitHub required).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_REL = 'src/main/db-schema-sync.ts';
const CURRENT_SCHEMA_RE = /export const CURRENT_SCHEMA_VERSION = (\d+)\s*;/;

/**
 * @param {string} source
 * @returns {number}
 */
export function parseCurrentSchemaVersion(source) {
  const m = CURRENT_SCHEMA_RE.exec(source);
  if (!m) {
    throw new Error('Could not parse CURRENT_SCHEMA_VERSION from source');
  }
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid CURRENT_SCHEMA_VERSION: ${m[1]}`);
  }
  return n;
}

/**
 * @param {string} filePath
 * @returns {number}
 */
export function readSchemaVersionFromFile(filePath) {
  return parseCurrentSchemaVersion(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {{
 *   mode: 'test-build' | 'release'
 *   currSchema: number
 *   prevSchema: number | null
 *   prevTag: string | null
 *   schemaBumped: boolean
 *   workflowLabel?: string
 * }} opts
 */
export function formatSchemaCompareMarkdown(opts) {
  const lines = [];
  if (opts.mode === 'test-build') {
    const workflowLabel = opts.workflowLabel?.trim() || 'Build Binaries';
    lines.push('# Test build — not an official release');
    lines.push('');
    lines.push(
      `These artifacts are from **${workflowLabel}** (\`workflow_dispatch\`). They are not a published GitHub Release.`,
    );
    lines.push('');
  } else {
    lines.push('# Release build — database schema check');
    lines.push('');
  }

  lines.push(`This build schema: **${opts.currSchema}**`);
  if (opts.prevTag == null || opts.prevSchema == null) {
    lines.push('Last official release: *(none found or schema unavailable)*');
    lines.push('');
    lines.push('Could not compare against a previous published release.');
  } else if (opts.schemaBumped) {
    lines.push(`Last official release: **${opts.prevTag}** (schema **${opts.prevSchema}**)`);
    lines.push('');
    lines.push(`## Database schema upgrade: ${opts.prevSchema} → ${opts.currSchema}`);
    lines.push('');
    lines.push(
      'Installing and launching this build will upgrade the local SQLite database. ' +
        'You **cannot downgrade** to an older Mesh-Client that only supports the previous schema ' +
        'while keeping the same database.',
    );
    lines.push('');
    lines.push(
      'On first launch, Mesh-Client shows a **Quit / Upgrade** dialog before changing the database.',
    );
  } else {
    lines.push(`Last official release: **${opts.prevTag}** (schema **${opts.prevSchema}**)`);
    lines.push('');
    lines.push('No schema bump vs last official release.');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {number} currSchema
 * @param {number | null} prevSchema
 */
export function isSchemaBumped(currSchema, prevSchema) {
  return prevSchema != null && currSchema > prevSchema;
}

/**
 * Reconstruct a trusted `vX.Y.Z` from validated digits (breaks CodeQL
 * `js/http-to-file-access` taint from GitHub release JSON → disk writes).
 * @param {unknown} tag
 * @returns {string}
 */
export function trustedReleaseTag(tag) {
  const m = typeof tag === 'string' ? /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) : null;
  if (!m) {
    throw new Error(`Unsafe release tag: ${JSON.stringify(tag)}`);
  }
  return `v${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
}

/** Release display names are X.Y.Z (no leading v) on GitHub Releases. */
export const SAFE_RELEASE_NAME_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Compare two trusted `vX.Y.Z` tags. Negative if a < b.
 * @param {string} a
 * @param {string} b
 */
export function compareReleaseTags(a, b) {
  const pa = trustedReleaseTag(a).slice(1).split('.').map(Number);
  const pb = trustedReleaseTag(b).slice(1).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Map a GitHub Releases API row to a trusted git tag for schema lookup.
 * Skips drafts/prereleases. Accepts normal `tag_name: vX.Y.Z`, and published
 * releases that lost their tag (`untagged-*` or empty) when `name` is still `X.Y.Z`
 * (seen after draft-fork / publish races — otherwise test builds warn against
 * an older release/schema).
 *
 * @param {{ tag_name?: unknown, name?: unknown, draft?: unknown, prerelease?: unknown } | null | undefined} release
 * @returns {string | null}
 */
export function publishedReleaseGitTag(release) {
  if (!release || release.draft === true || release.prerelease === true) {
    return null;
  }
  const tag = release.tag_name;
  if (typeof tag === 'string' && /^v\d+\.\d+\.\d+$/.test(tag)) {
    return trustedReleaseTag(tag);
  }
  // Name fallback only when tag is missing or GitHub's untagged-* placeholder —
  // not for arbitrary invalid tags (e.g. tag_name "broken" + name "5.27.0").
  const tagMissing = tag == null || tag === '';
  const tagUntagged = typeof tag === 'string' && /^untagged-/i.test(tag);
  if (!tagMissing && !tagUntagged) {
    return null;
  }
  const name = release.name;
  if (typeof name === 'string') {
    const m = SAFE_RELEASE_NAME_RE.exec(name);
    if (m) {
      return trustedReleaseTag(`v${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`);
    }
  }
  return null;
}

/**
 * Coerce a schema version to a trusted positive integer.
 * @param {unknown} value
 * @returns {number}
 */
export function trustedSchemaVersion(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid schema version: ${JSON.stringify(value)}`);
  }
  return n;
}

/**
 * @param {string} tag
 * @param {string} [cwd]
 */
export function readSchemaVersionFromGitTag(tag, cwd = ROOT) {
  const safeTag = trustedReleaseTag(tag);
  const source = execFileSync('git', ['show', `${safeTag}:${SCHEMA_REL}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return trustedSchemaVersion(parseCurrentSchemaVersion(source));
}

/**
 * Pick the highest-semver published release tag from a GitHub Releases list.
 * @param {Array<{ tag_name?: unknown, name?: unknown, draft?: unknown, prerelease?: unknown }>} releases
 * @param {string} [excludeTag]
 * @returns {string | null}
 */
export function pickLatestPublishedReleaseTag(releases, excludeTag) {
  if (!Array.isArray(releases)) {
    return null;
  }
  /** @type {string[]} */
  const candidates = [];
  for (const release of releases) {
    const tag = publishedReleaseGitTag(release);
    if (!tag) continue;
    if (excludeTag && tag === excludeTag) continue;
    candidates.push(tag);
  }
  if (candidates.length === 0) {
    return null;
  }
  // Prefer highest semver — API order is not reliable when drafts / untagged
  // rows interleave with published releases.
  candidates.sort((a, b) => compareReleaseTags(b, a));
  return candidates[0];
}

/**
 * Parse the next page URL from a GitHub `Link` response header.
 * @param {string | null | undefined} linkHeader
 * @returns {string | null}
 */
export function parseGithubLinkNext(linkHeader) {
  if (typeof linkHeader !== 'string' || !linkHeader) {
    return null;
  }
  for (const segment of linkHeader.split(',')) {
    const match = segment.match(/<([^>]+)>\s*;\s*rel="next"/i);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Fetch every Releases API page (follows `Link: rel="next"`).
 * @param {{
 *   owner?: string,
 *   repo?: string,
 *   headers?: Record<string, string>,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 * @returns {Promise<Array<{ tag_name?: string, name?: string, draft?: boolean, prerelease?: boolean }>>}
 */
export async function fetchAllGithubReleases(opts = {}) {
  const owner = opts.owner ?? 'Colorado-Mesh';
  const repo = opts.repo ?? 'mesh-client';
  const headers = opts.headers ?? {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const fetchImpl = opts.fetchImpl ?? fetch;

  /** @type {Array<{ tag_name?: string, name?: string, draft?: boolean, prerelease?: boolean }>} */
  const releases = [];
  let url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;
  while (url) {
    const listRes = await fetchImpl(url, { headers });
    if (!listRes.ok) {
      throw new Error(`List releases failed (${listRes.status}): ${await listRes.text()}`);
    }
    const page = await listRes.json();
    if (!Array.isArray(page)) {
      throw new Error('Unexpected releases list payload');
    }
    releases.push(...page);
    url = parseGithubLinkNext(listRes.headers.get('link'));
  }
  return releases;
}

/**
 * @param {{ token?: string, owner?: string, repo?: string, excludeTag?: string }} [opts]
 * @returns {Promise<{ tag: string, schema: number } | null>}
 */
export async function fetchLatestPublishedReleaseSchema(opts = {}) {
  const owner = opts.owner ?? 'Colorado-Mesh';
  const repo = opts.repo ?? 'mesh-client';
  const token = opts.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const releases = await fetchAllGithubReleases({ owner, repo, headers });
  const tag = pickLatestPublishedReleaseTag(releases, opts.excludeTag);
  if (!tag) {
    return null;
  }

  try {
    execFileSync('git', ['fetch', '--depth', '1', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    // Tag may already exist locally; git show below will fail loudly if missing.
  }

  const schema = readSchemaVersionFromGitTag(tag);
  return { tag, schema };
}

/**
 * @param {Record<string, string>} outputs
 * @param {string} [outputPath]
 */
export function writeGithubOutput(outputs, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

/**
 * @param {string} markdown
 * @param {string} [summaryPath]
 */
export function writeStepSummary(markdown, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, markdown.endsWith('\n') ? markdown : `${markdown}\n`);
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 */
export async function runSchemaReleaseCompare(argv, env = process.env) {
  const mode = argv.includes('--release') ? 'release' : 'test-build';
  const excludeIdx = argv.indexOf('--exclude-tag');
  const excludeTag =
    excludeIdx >= 0 && argv[excludeIdx + 1]
      ? argv[excludeIdx + 1]
      : typeof env.RELEASE_TAG === 'string' && env.RELEASE_TAG
        ? env.RELEASE_TAG
        : undefined;

  const readmeIdx = argv.indexOf('--write-readme');
  const readmePath =
    readmeIdx >= 0 && argv[readmeIdx + 1]
      ? path.resolve(argv[readmeIdx + 1])
      : path.join(ROOT, 'READ-ME-FIRST-test-build.md');

  const labelIdx = argv.indexOf('--workflow-label');
  const workflowLabel =
    labelIdx >= 0 && argv[labelIdx + 1]
      ? argv[labelIdx + 1]
      : typeof env.MESH_CLIENT_SCHEMA_WORKFLOW_LABEL === 'string' &&
          env.MESH_CLIENT_SCHEMA_WORKFLOW_LABEL
        ? env.MESH_CLIENT_SCHEMA_WORKFLOW_LABEL
        : undefined;

  const currFile = path.join(ROOT, SCHEMA_REL);
  const currSchema = trustedSchemaVersion(readSchemaVersionFromFile(currFile));

  let prevSchema = null;
  let prevTag = null;
  const prevSchemaEnv = env.MESH_CLIENT_SCHEMA_PREV;
  const prevTagEnv = env.MESH_CLIENT_SCHEMA_PREV_TAG;
  if (typeof prevSchemaEnv === 'string' && prevSchemaEnv !== '' && /^\d+$/.test(prevSchemaEnv)) {
    if (typeof prevTagEnv === 'string' && prevTagEnv && /^v\d+\.\d+\.\d+$/.test(prevTagEnv)) {
      prevSchema = trustedSchemaVersion(prevSchemaEnv);
      prevTag = trustedReleaseTag(prevTagEnv);
    }
  } else if (!argv.includes('--offline')) {
    const prev = await fetchLatestPublishedReleaseSchema({ excludeTag });
    if (prev) {
      prevSchema = trustedSchemaVersion(prev.schema);
      prevTag = trustedReleaseTag(prev.tag);
    }
  }

  const schemaBumped = isSchemaBumped(currSchema, prevSchema);
  // Markdown is built only from trusted integers / reconstructed tags (not raw HTTP JSON).
  const markdown = formatSchemaCompareMarkdown({
    mode,
    currSchema,
    prevSchema,
    prevTag,
    schemaBumped,
    workflowLabel,
  });

  writeStepSummary(markdown, env.GITHUB_STEP_SUMMARY);
  fs.writeFileSync(readmePath, markdown, 'utf8');

  writeGithubOutput(
    {
      schema_bumped: schemaBumped ? 'true' : 'false',
      curr_schema: String(currSchema),
      prev_schema: prevSchema == null ? '' : String(prevSchema),
      prev_tag: prevTag ?? '',
    },
    env.GITHUB_OUTPUT,
  );

  // Also print for logs (console.debug aliases console.log in Node; keeps App Log filterable if reused)
  console.debug(markdown.trimEnd());

  return {
    mode,
    currSchema,
    prevSchema,
    prevTag,
    schemaBumped,
    readmePath,
    markdown,
  };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  runSchemaReleaseCompare(process.argv.slice(2)).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[ci-schema-release-compare] ${detail}`);
    process.exit(1);
  });
}
