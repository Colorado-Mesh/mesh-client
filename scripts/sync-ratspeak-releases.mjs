#!/usr/bin/env node
/**
 * Resolve the latest published GitHub Release (or default-branch tip when a
 * repo has no releases) for each Ratspeak stack dependency and write
 * reticulum-sidecar/ratspeak-stack-pins.env. Also refreshes the vendored
 * identity vault from the latest ratspeak/Ratspeak release.
 *
 * Invoked by scripts/update.sh so the stack always tracks current releases
 * rather than hand-held SHA pins.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PINS_FILE = path.join(ROOT, 'reticulum-sidecar', 'ratspeak-stack-pins.env');
const VAULT_VENDOR = path.join(ROOT, 'reticulum-sidecar', 'vendor', 'ratspeak_vault.rs');
/** @typedef {{ envKey: string, owner: string, repo: string }} StackRepo */

/** @type {StackRepo[]} */
const STACK = [
  { envKey: 'RS_RETICULUM_PIN', owner: 'ratspeak', repo: 'rsReticulum' },
  { envKey: 'RS_LXMF_PIN', owner: 'ratspeak', repo: 'rsLXMF' },
  { envKey: 'RS_NOMAD_PIN', owner: 'Colorado-Mesh', repo: 'rsNomad' },
  { envKey: 'RS_LXST_PIN', owner: 'ratspeak', repo: 'rsLXST' },
  { envKey: 'RS_LRGP_PIN', owner: 'ratspeak', repo: 'lrgp-rs' },
];

/**
 * @param {string[]} args
 * @returns {string}
 */
function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * @param {string} full owner/repo
 * @returns {string | null}
 */
function latestReleaseTag(full) {
  try {
    return gh(['release', 'view', '--repo', full, '--json', 'tagName', '--jq', '.tagName']);
  } catch {
    return null;
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 * @returns {{ tag: string | null, sha: string }}
 */
function resolveLatest(owner, repo) {
  const full = `${owner}/${repo}`;
  const tag = latestReleaseTag(full);

  if (tag) {
    // Peel annotated tags to the commit object.
    const refJson = gh(['api', `repos/${full}/git/ref/tags/${tag}`]);
    const ref = JSON.parse(refJson);
    let sha = String(ref.object?.sha ?? '');
    if (ref.object?.type === 'tag') {
      const tagObj = JSON.parse(gh(['api', `repos/${full}/git/tags/${sha}`]));
      sha = String(tagObj.object?.sha ?? '');
    }
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error(`${full}@${tag}: could not resolve commit SHA`);
    }
    return { tag, sha };
  }

  // No GitHub Release (e.g. Colorado-Mesh/rsNomad) — use default branch tip.
  const meta = JSON.parse(gh(['api', `repos/${full}`]));
  const branch = String(meta.default_branch || 'main');
  const commit = JSON.parse(gh(['api', `repos/${full}/commits/${branch}`]));
  const sha = String(commit.sha ?? '');
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`${full}@${branch}: could not resolve commit SHA`);
  }
  return { tag: null, sha };
}

/**
 * Vault releases that import DurableFileReceipt / durable_* need an rsReticulum
 * pin that already exports those symbols. Prefer-latest holds the vault when the
 * published rsReticulum release has not caught up yet.
 *
 * @param {string} vaultBody
 * @returns {boolean}
 */
export function vaultNeedsDurablePersistence(vaultBody) {
  return (
    /\bDurableFileReceipt\b/.test(vaultBody) ||
    /\bDurableCommitPhase\b/.test(vaultBody) ||
    /\bdurable_write\b/.test(vaultBody) ||
    /\bdurable_remove\b/.test(vaultBody)
  );
}

/**
 * @param {string} persistenceRsBody crates/rns-identity/src/persistence.rs
 * @returns {boolean}
 */
export function persistenceExportsDurableApis(persistenceRsBody) {
  return (
    /\bDurableFileReceipt\b/.test(persistenceRsBody) &&
    /\bDurableCommitPhase\b/.test(persistenceRsBody) &&
    /\bdurable_write\b/.test(persistenceRsBody) &&
    /\bdurable_remove\b/.test(persistenceRsBody)
  );
}

/**
 * @param {string} vaultBody
 * @param {string} persistenceRsBody
 * @returns {boolean} true when the vault may be written against this pin
 */
export function shouldRefreshVaultAgainstReticulum(vaultBody, persistenceRsBody) {
  if (!vaultNeedsDurablePersistence(vaultBody)) return true;
  return persistenceExportsDurableApis(persistenceRsBody);
}

/**
 * @param {string} tag
 * @returns {{ sha: string, body: string }}
 */
function fetchVaultFromRatspeakRelease(tag) {
  const commits = JSON.parse(
    gh([
      'api',
      `repos/ratspeak/Ratspeak/commits?path=crates/ratspeak-runtime/src/vault.rs&sha=${encodeURIComponent(tag)}&per_page=1`,
    ]),
  );
  const sha = String(commits[0]?.sha ?? '');
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Ratspeak@${tag}: could not resolve vault.rs commit`);
  }
  const encoded = gh([
    'api',
    `repos/ratspeak/Ratspeak/contents/crates/ratspeak-runtime/src/vault.rs?ref=${encodeURIComponent(tag)}`,
    '--jq',
    '.content',
  ]);
  const body = Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf8');
  if (!body.includes('encrypt_identity')) {
    throw new Error(`Ratspeak@${tag}: vault.rs content looks wrong`);
  }
  return { sha, body };
}

/**
 * @param {string} reticulumSha
 * @returns {string}
 */
function fetchReticulumPersistenceRs(reticulumSha) {
  const encoded = gh([
    'api',
    `repos/ratspeak/rsReticulum/contents/crates/rns-identity/src/persistence.rs?ref=${encodeURIComponent(reticulumSha)}`,
    '--jq',
    '.content',
  ]);
  return Buffer.from(encoded.replace(/\n/g, ''), 'base64').toString('utf8');
}

/**
 * @param {Map<string, { tag: string | null, sha: string }>} resolved
 */
function writePinsEnv(resolved) {
  const lines = [
    '# Resolved from the latest published GitHub Release for each stack repo',
    '# (default-branch tip when a repo has no Releases). Regenerated by',
    '# `node scripts/sync-ratspeak-releases.mjs` / `pnpm run update` — do not',
    '# hand-edit SHAs to hold an older release. flake.nix and',
    '# scripts/clone-ratspeak-stack.sh read these KEY=<40-hex> lines.',
    '',
  ];
  for (const { envKey } of STACK) {
    const hit = resolved.get(envKey);
    if (!hit) throw new Error(`missing resolution for ${envKey}`);
    if (hit.tag) {
      lines.push(`# ${envKey} ← ${hit.tag}`);
    } else {
      lines.push(`# ${envKey} ← default-branch tip (no GitHub Release)`);
    }
    lines.push(`${envKey}=${hit.sha}`);
  }
  lines.push('');
  fs.writeFileSync(PINS_FILE, `${lines.join('\n')}\n`);
}

/**
 * @param {string} sha
 * @param {string} body
 */
function writeVaultVendor(sha, body) {
  const header = [
    '// Vendored from ratspeak/Ratspeak crates/ratspeak-runtime/src/vault.rs',
    `// Upstream commit: ${sha}`,
    '// Do not edit by hand — refresh via scripts/sync-ratspeak-releases.mjs.',
    '',
  ].join('\n');
  fs.writeFileSync(VAULT_VENDOR, header + body);
}

function main() {
  /** @type {Map<string, { tag: string | null, sha: string }>} */
  const resolved = new Map();
  console.log('Syncing Ratspeak stack to latest published releases...');
  for (const entry of STACK) {
    const { tag, sha } = resolveLatest(entry.owner, entry.repo);
    resolved.set(entry.envKey, { tag, sha });
    const label = tag ?? 'default-branch';
    console.log(`  ${entry.owner}/${entry.repo}: ${label} → ${sha.slice(0, 12)}`);
  }
  writePinsEnv(resolved);

  const ratspeakTag = gh([
    'release',
    'view',
    '--repo',
    'ratspeak/Ratspeak',
    '--json',
    'tagName',
    '--jq',
    '.tagName',
  ]);
  console.log(`Syncing identity vault from ratspeak/Ratspeak ${ratspeakTag}...`);
  const vault = fetchVaultFromRatspeakRelease(ratspeakTag);
  const reticulum = resolved.get('RS_RETICULUM_PIN');
  if (!reticulum) throw new Error('missing RS_RETICULUM_PIN resolution');
  const persistenceRs = vaultNeedsDurablePersistence(vault.body)
    ? fetchReticulumPersistenceRs(reticulum.sha)
    : '';
  if (!shouldRefreshVaultAgainstReticulum(vault.body, persistenceRs)) {
    console.warn(
      `  Skipping vault refresh from ${ratspeakTag}: needs DurableFileReceipt APIs not in rsReticulum @ ${reticulum.sha.slice(0, 12)} (hold until a release includes them).`,
    );
  } else {
    writeVaultVendor(vault.sha, vault.body);
    console.log(`  vault.rs @ ${vault.sha.slice(0, 12)} (from ${ratspeakTag})`);
  }
  console.log(`Wrote ${path.relative(ROOT, PINS_FILE)}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main();
}
