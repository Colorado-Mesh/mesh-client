#!/usr/bin/env node
/**
 * Ensure a draft GitHub release exists for the current tag before parallel
 * electron-builder --publish always jobs run.
 *
 * Failure point: concurrent publish jobs each create their own draft release;
 * uploads to the loser release id 404 when GitHub consolidates/deletes it.
 * Fallback: create once here; matrix jobs attach assets to the same release.
 */

const OWNER = 'Colorado-Mesh';
const REPO = 'mesh-client';
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;

function fail(message) {
  console.error(`[ci-ensure-github-draft-release] ${message}`);
  process.exit(1);
}

function resolveTag(argv, env) {
  const flagIndex = argv.indexOf('--tag');
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }
  const ref = env.GITHUB_REF ?? '';
  if (ref.startsWith('refs/tags/')) {
    return ref.slice('refs/tags/'.length);
  }
  fail('Missing tag: pass --tag vX.Y.Z or run on a refs/tags/v* workflow ref');
}

function authToken(env) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (!token) {
    fail('GH_TOKEN or GITHUB_TOKEN is required');
  }
  return token;
}

async function githubRequest(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
  }

  return { response, json };
}

async function getReleaseByTag(tag, token) {
  const { response, json } = await githubRequest(`/releases/tags/${encodeURIComponent(tag)}`, {
    token,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    fail(
      `GET release for ${tag} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }
  return json;
}

async function createDraftRelease(tag, token) {
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  const { response, json } = await githubRequest('/releases', {
    token,
    method: 'POST',
    body: {
      tag_name: tag,
      name: version,
      draft: true,
      generate_release_notes: false,
      body: `Draft release for ${tag}. CI is uploading platform artifacts.`,
    },
  });

  if (response.status === 422) {
    // Another job won the race — re-fetch by tag.
    const existing = await getReleaseByTag(tag, token);
    if (existing) {
      return existing;
    }
  }

  if (!response.ok) {
    fail(
      `POST draft release for ${tag} failed (${response.status}): ${json?.message ?? response.statusText}`,
    );
  }

  return json;
}

export async function ensureGithubDraftRelease({ tag, token, log = console.debug }) {
  const existing = await getReleaseByTag(tag, token);
  if (existing) {
    log(`[ci-ensure-github-draft-release] Using existing release ${existing.id} for ${tag}`);
    return existing;
  }

  const created = await createDraftRelease(tag, token);
  log(`[ci-ensure-github-draft-release] Created draft release ${created.id} for ${tag}`);
  return created;
}

import { pathToFileURL } from 'node:url';

async function main() {
  const tag = resolveTag(process.argv.slice(2), process.env);
  const token = authToken(process.env);
  await ensureGithubDraftRelease({ tag, token });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Unexpected error: ${detail}`);
  });
}
