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
 * }} opts
 */
export function formatSchemaCompareMarkdown(opts) {
  const lines = [];
  if (opts.mode === 'test-build') {
    lines.push('# Test build — not an official release');
    lines.push('');
    lines.push(
      'These artifacts are from **Build Binaries** (`workflow_dispatch`). They are not a published GitHub Release.',
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
 * @param {string} tag
 * @param {string} [cwd]
 */
export function readSchemaVersionFromGitTag(tag, cwd = ROOT) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Unsafe git tag for schema lookup: ${JSON.stringify(tag)}`);
  }
  const source = execFileSync('git', ['show', `${tag}:${SCHEMA_REL}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  return parseCurrentSchemaVersion(source);
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

  const listUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`;
  const listRes = await fetch(listUrl, { headers });
  if (!listRes.ok) {
    throw new Error(`List releases failed (${listRes.status}): ${await listRes.text()}`);
  }
  /** @type {Array<{ tag_name?: string, draft?: boolean, prerelease?: boolean }>} */
  const releases = await listRes.json();
  if (!Array.isArray(releases)) {
    throw new Error('Unexpected releases list payload');
  }

  const candidate = releases.find((r) => {
    if (!r || r.draft === true || r.prerelease === true) return false;
    const tag = r.tag_name;
    if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) return false;
    if (opts.excludeTag && tag === opts.excludeTag) return false;
    return true;
  });
  if (!candidate?.tag_name) {
    return null;
  }

  const tag = candidate.tag_name;
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

  const currFile = path.join(ROOT, SCHEMA_REL);
  const currSchema = readSchemaVersionFromFile(currFile);

  let prevSchema = null;
  let prevTag = null;
  const prevSchemaEnv = env.MESH_CLIENT_SCHEMA_PREV;
  const prevTagEnv = env.MESH_CLIENT_SCHEMA_PREV_TAG;
  if (typeof prevSchemaEnv === 'string' && prevSchemaEnv !== '' && /^\d+$/.test(prevSchemaEnv)) {
    prevSchema = Number(prevSchemaEnv);
    prevTag = typeof prevTagEnv === 'string' && prevTagEnv ? prevTagEnv : 'unknown';
  } else if (!argv.includes('--offline')) {
    const prev = await fetchLatestPublishedReleaseSchema({ excludeTag });
    if (prev) {
      prevSchema = prev.schema;
      prevTag = prev.tag;
    }
  }

  const schemaBumped = isSchemaBumped(currSchema, prevSchema);
  const markdown = formatSchemaCompareMarkdown({
    mode,
    currSchema,
    prevSchema,
    prevTag,
    schemaBumped,
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
