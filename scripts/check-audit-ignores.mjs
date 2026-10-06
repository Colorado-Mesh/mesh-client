#!/usr/bin/env node
/**
 * Warn when an advisory listed in `pnpm-workspace.yaml` → `auditConfig.ignoreGhsas`
 * gets a patched release (or is withdrawn), so the audit exception can be backed out
 * instead of silently outliving the fix. Each ignore is documented inline in the YAML
 * with why it is unreachable and "remove once a patched release lands". An ignore is
 * also removable when no locked version falls inside the advisory's vulnerable range.
 *
 * Warning-only and network-dependent — called from scripts/update.sh, never from
 * pre-commit or check:pr. GitHub API failures are reported as skips, not errors.
 *
 * Exit codes: 0 = nothing to back out (or offline), 10 = at least one ignore is removable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import semver from 'semver';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_YAML = path.join(ROOT, 'pnpm-workspace.yaml');
const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 10_000;
const GHSA_ID = /\bGHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/i;

export const REMOVABLE_EXIT_CODE = 10;

/**
 * GHSA ids under `auditConfig:` → `ignoreGhsas:`. Line-scoped on purpose so the check
 * needs no YAML dependency (same approach as check-pinned-majors.mjs).
 *
 * @param {string} yamlText
 * @returns {string[]}
 */
export function parseIgnoredGhsas(yamlText) {
  const ids = [];
  let inAuditConfig = false;
  let inIgnoreList = false;

  for (const rawLine of yamlText.split('\n')) {
    if (/^auditConfig:\s*$/.test(rawLine)) {
      inAuditConfig = true;
      continue;
    }
    if (!inAuditConfig) continue;

    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (/^\S/.test(rawLine)) break;
    if (/^ignoreGhsas:\s*$/.test(line)) {
      inIgnoreList = true;
      continue;
    }
    if (!line.startsWith('-')) {
      inIgnoreList = false;
      continue;
    }
    if (!inIgnoreList) continue;

    const match = GHSA_ID.exec(line);
    if (match) ids.push(match[0]);
  }

  return [...new Set(ids)];
}

/**
 * Package versions pinned as `name@version` keys in a pnpm lockfile.
 * A scoped suffix such as `@types/http-cache-semantics` does not count as `http-cache-semantics`.
 *
 * @param {string} lockText
 * @returns {Map<string, string[]>}
 */
export function lockedVersionsByPackage(lockText) {
  /** @type {Map<string, string[]>} */
  const map = new Map();
  for (const rawLine of lockText.split('\n')) {
    let key = rawLine.trim();
    if (!key.includes('@')) continue;
    if (key.startsWith("'") || key.startsWith('"')) {
      const quote = key[0];
      const end = key.indexOf(quote, 1);
      if (end <= 1) continue;
      key = key.slice(1, end);
    } else {
      const colon = key.indexOf(':');
      if (colon === -1) continue;
      key = key.slice(0, colon).trim();
    }
    const peer = key.indexOf('(');
    if (peer !== -1) key = key.slice(0, peer);
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (!semver.valid(version)) continue;
    const list = map.get(name);
    if (list) {
      if (!list.includes(version)) list.push(version);
    } else {
      map.set(name, [version]);
    }
  }
  return map;
}

/**
 * @param {string} version
 * @param {string} range GitHub `vulnerable_version_range` (operators may include spaces)
 * @returns {boolean | null} null when the version or range cannot be parsed
 */
export function versionInVulnerableRange(version, range) {
  if (typeof version !== 'string' || typeof range !== 'string') return null;
  if (!semver.valid(version)) return null;
  const normalized = semver.validRange(range.trim());
  if (!normalized) return null;
  return semver.satisfies(version, normalized, { includePrerelease: true });
}

/**
 * True when every npm advisory package has no locked version inside its vulnerable range.
 * An unparseable range stays "not clear" so the ignore is kept.
 *
 * @param {unknown[]} npmVulns
 * @param {Map<string, string[]>} lockedVersions
 * @returns {boolean}
 */
function lockfileClearsAdvisory(npmVulns, lockedVersions) {
  return npmVulns.every((v) => {
    const name = v?.package?.name;
    const range = v?.vulnerable_version_range;
    if (typeof name !== 'string' || typeof range !== 'string') return false;
    const versions = lockedVersions.get(name) ?? [];
    return versions.every((ver) => versionInVulnerableRange(ver, range) === false);
  });
}

/**
 * Decide whether an ignored advisory can be backed out.
 *
 * @param {string} ghsaId
 * @param {unknown} advisory GitHub global advisory JSON, or null when the lookup failed
 * @param {Map<string, string[]> | null} [lockedVersions] lockfile versions; omit to skip that check
 * @returns {{ ghsaId: string, status: 'removable' | 'unpatched' | 'skipped', reason: string, packages: string[] }}
 */
export function evaluateIgnoredAdvisory(ghsaId, advisory, lockedVersions = null) {
  if (!advisory || typeof advisory !== 'object') {
    return {
      ghsaId,
      status: 'skipped',
      reason: 'GitHub advisory lookup unavailable',
      packages: [],
    };
  }
  const { withdrawn_at: withdrawnAt, vulnerabilities } = /** @type {Record<string, unknown>} */ (
    advisory
  );
  const vulns = Array.isArray(vulnerabilities) ? vulnerabilities : [];
  const packages = vulns.map((v) => {
    const name = v?.package?.name ?? 'unknown';
    const patched = typeof v?.first_patched_version === 'string' ? v.first_patched_version : null;
    return patched ? `${name} >=${patched}` : `${name} (no patch)`;
  });

  if (typeof withdrawnAt === 'string' && withdrawnAt) {
    return { ghsaId, status: 'removable', reason: `advisory withdrawn ${withdrawnAt}`, packages };
  }
  // pnpm audit only reports npm packages; one unpatched npm entry still needs the ignore.
  const npmVulns = vulns.filter((v) => v?.package?.ecosystem === 'npm');
  if (npmVulns.length === 0) {
    return { ghsaId, status: 'skipped', reason: 'no npm vulnerabilities', packages };
  }
  const patchedAll = npmVulns.every((v) => typeof v?.first_patched_version === 'string');
  if (patchedAll) {
    return { ghsaId, status: 'removable', reason: 'patched release available', packages };
  }
  if (lockedVersions && lockfileClearsAdvisory(npmVulns, lockedVersions)) {
    return {
      ghsaId,
      status: 'removable',
      reason: 'no locked version is in the vulnerable range',
      packages,
    };
  }
  return { ghsaId, status: 'unpatched', reason: 'no patched release yet', packages };
}

/** Global advisory JSON, or null on any network / API failure. */
async function fetchAdvisory(ghsaId) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  try {
    const res = await fetch(`${GITHUB_API}/advisories/${encodeURIComponent(ghsaId)}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mesh-client-update',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    // catch-no-log-ok offline / API outage is a skip, reported by the caller
    return null;
  }
}

async function main() {
  console.log('');
  console.log('Checking pnpm audit ignores (auditConfig.ignoreGhsas) for patched releases...');

  if (!fs.existsSync(WORKSPACE_YAML)) {
    console.log('  pnpm-workspace.yaml missing — skip.');
    return 0;
  }

  const ids = parseIgnoredGhsas(fs.readFileSync(WORKSPACE_YAML, 'utf8'));
  if (ids.length === 0) {
    console.log('  No audit ignores declared — nothing to check.');
    return 0;
  }

  const lockPath = path.join(ROOT, 'pnpm-lock.yaml');
  const lockedVersions = fs.existsSync(lockPath)
    ? lockedVersionsByPackage(fs.readFileSync(lockPath, 'utf8'))
    : null;
  const advisories = await Promise.all(ids.map((id) => fetchAdvisory(id)));
  const results = ids.map((id, i) => evaluateIgnoredAdvisory(id, advisories[i], lockedVersions));

  let removable = 0;
  for (const r of results) {
    const pkgs = r.packages.length > 0 ? ` [${r.packages.join(', ')}]` : '';
    if (r.status === 'removable') {
      removable++;
      console.log('');
      console.log(`  Audit ignore can be backed out: ${r.ghsaId} — ${r.reason}${pkgs}`);
      console.log(`    https://github.com/advisories/${r.ghsaId}`);
      if (r.reason === 'no locked version is in the vulnerable range') {
        console.log('    No locked version falls in the advisory range.');
        console.log('    Confirm `pnpm audit` is clean, then remove the entry (and its comment)');
        console.log('    from auditConfig.ignoreGhsas.');
      } else {
        console.log(
          '    Bump the package past the patched version, confirm `pnpm audit` is clean,',
        );
        console.log('    then remove the entry (and its comment) from auditConfig.ignoreGhsas.');
      }
    } else if (r.status === 'unpatched') {
      console.log(`  ${r.ghsaId}: ${r.reason}${pkgs} — keep ignore`);
    } else {
      console.log(`  ${r.ghsaId}: ${r.reason} — skipped`);
    }
  }

  return removable > 0 ? REMOVABLE_EXIT_CODE : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main());
}
