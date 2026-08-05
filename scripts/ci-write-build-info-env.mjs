#!/usr/bin/env node
/**
 * Write MESH_CLIENT_BUILD_INFO JSON to GITHUB_ENV for packaging jobs.
 *
 * Required env:
 *   MESH_CLIENT_BUILD_CHANNEL — `test` | `release`
 *
 * Optional:
 *   MESH_CLIENT_BUILD_WORKFLOW — workflow display name
 *   MESH_CLIENT_BUILD_TAG — release tag (e.g. v5.26.0); default from package.json when channel=release
 *
 * Uses standard Actions env: GITHUB_ENV, GITHUB_RUN_ID, GITHUB_RUN_NUMBER,
 * GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_REPOSITORY.
 *
 * Pure helpers exported for unit tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/**
 * @param {string} sha
 * @returns {string}
 */
export function shortSha(sha) {
  const trimmed = sha.trim();
  if (trimmed.length === 0) return '';
  return trimmed.slice(0, 7);
}

/**
 * @param {{
 *   channel: 'test' | 'release'
 *   workflow?: string
 *   runId?: string
 *   runNumber?: string | number
 *   sha?: string
 *   serverUrl?: string
 *   repository?: string
 *   tag?: string
 * }} opts
 */
export function buildMeshClientBuildInfoPayload(opts) {
  const channel = opts.channel;
  if (channel !== 'test' && channel !== 'release') {
    throw new Error(`MESH_CLIENT_BUILD_CHANNEL must be test|release, got: ${String(channel)}`);
  }

  /** @type {Record<string, string | number>} */
  const payload = { channel };

  const workflow = opts.workflow?.trim();
  if (workflow) payload.workflow = workflow;

  const runId = opts.runId?.trim();
  if (runId) payload.runId = runId;

  if (opts.runNumber !== undefined && opts.runNumber !== '') {
    const n = typeof opts.runNumber === 'number' ? opts.runNumber : Number(String(opts.runNumber));
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`Invalid GITHUB_RUN_NUMBER: ${String(opts.runNumber)}`);
    }
    payload.runNumber = Math.floor(n);
  }

  const shaFull = opts.sha?.trim() ?? '';
  const sha = shortSha(shaFull);
  if (sha) payload.sha = sha;

  const serverUrl = (opts.serverUrl ?? 'https://github.com').replace(/\/$/, '');
  const repository = opts.repository?.trim();
  if (runId && repository) {
    payload.runUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
  }

  if (channel === 'release') {
    const tag = opts.tag?.trim();
    if (tag) payload.tag = tag;
  }

  return payload;
}

/**
 * @param {Record<string, string | number>} payload
 * @returns {string}
 */
export function formatGithubEnvAssignment(payload) {
  const json = JSON.stringify(payload);
  // Heredoc form keeps JSON special characters safe on all runners (including Windows).
  return `MESH_CLIENT_BUILD_INFO<<MESH_BUILD_INFO_EOF\n${json}\nMESH_BUILD_INFO_EOF\n`;
}

/**
 * @param {string} [packageJsonPath]
 * @returns {string}
 */
export function readReleaseTagFromPackageJson(packageJsonPath = path.join(ROOT, 'package.json')) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = pkg?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(`Invalid package.json version for release tag: ${String(version)}`);
  }
  return `v${version}`;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ writeEnvFile?: boolean, packageJsonPath?: string }} [opts]
 */
export function writeBuildInfoEnv(env = process.env, opts = {}) {
  const channel = env.MESH_CLIENT_BUILD_CHANNEL?.trim();
  if (channel !== 'test' && channel !== 'release') {
    throw new Error(
      `MESH_CLIENT_BUILD_CHANNEL must be test|release, got: ${String(env.MESH_CLIENT_BUILD_CHANNEL)}`,
    );
  }

  let tag = env.MESH_CLIENT_BUILD_TAG?.trim();
  if (channel === 'release' && !tag) {
    tag = readReleaseTagFromPackageJson(opts.packageJsonPath);
  }

  const payload = buildMeshClientBuildInfoPayload({
    channel,
    workflow: env.MESH_CLIENT_BUILD_WORKFLOW,
    runId: env.GITHUB_RUN_ID,
    runNumber: env.GITHUB_RUN_NUMBER,
    sha: env.GITHUB_SHA,
    serverUrl: env.GITHUB_SERVER_URL,
    repository: env.GITHUB_REPOSITORY,
    tag,
  });

  const assignment = formatGithubEnvAssignment(payload);
  const writeEnvFile = opts.writeEnvFile !== false;
  const githubEnv = env.GITHUB_ENV;
  if (writeEnvFile) {
    if (!githubEnv) {
      throw new Error('GITHUB_ENV is not set — refuse to print secrets-style env to stdout alone');
    }
    fs.appendFileSync(githubEnv, assignment, 'utf8');
  }
  return { payload, assignment };
}

function main() {
  const { payload } = writeBuildInfoEnv();
  console.log(
    `Wrote MESH_CLIENT_BUILD_INFO channel=${payload.channel}` +
      (payload.runId ? ` runId=${payload.runId}` : '') +
      (payload.tag ? ` tag=${payload.tag}` : ''),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
