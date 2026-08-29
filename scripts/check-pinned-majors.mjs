#!/usr/bin/env node
/**
 * Warn when a pinned dependency in `pnpm-workspace.yaml` → `overrides` has fallen
 * behind a newer major on npm. Stale caps silently withhold upstream fixes: the
 * `undici: ^7.29.0` floor kept the app on a version that crashed the main process
 * with `setTypeOfService EINVAL` long after nodejs/undici#5547 shipped in 8.x.
 *
 * Warning-only and network-dependent — called from scripts/update.sh, never from
 * pre-commit or check:pr. Registry failures are reported as skips, not errors.
 *
 * Exit codes: 0 = clean (or offline), 10 = at least one unexplained major drift.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_YAML = path.join(ROOT, 'pnpm-workspace.yaml');
const REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 10_000;

export const DRIFT_EXIT_CODE = 10;

/**
 * Caps that are correct as-is: the consuming package's own range forbids the newer
 * major, or the pin is a deliberate platform target. Keep one entry per package with
 * the blocking consumer named, so a reviewer can re-check it against `pnpm why`.
 */
export const PINNED_MAJOR_EXCEPTIONS = {
  '@babel/core': 'eslint-plugin-react-hooks requires ^7',
  'cacheable-request': 'got@11 (via @electron/get) requires ^10',
  electron: 'app platform target — major upgrades are a deliberate, separate change',
  'fast-uri': 'ajv@8 (via app-builder-lib) requires ^3',
  'js-yaml': 'app-builder-lib / electron-updater / markdownlint-cli2 all require ^4',
  'markdown-it': 'scoped security floor for markdownlint-cli2; 15.x is a separate upgrade',
  undici: 'scoped floor lifting transitive 6.x/7.x consumers; the app depends on ^8 directly',
  'undici-types': '@types/node pins the 7.x line',
};

/**
 * Extract `overrides:` entries from pnpm-workspace.yaml. Line-scoped on purpose so
 * the check needs no YAML dependency (it also runs before/independently of install).
 *
 * @param {string} yamlText
 * @returns {{ key: string, packageName: string, selector: string | null, range: string }[]}
 */
export function parseOverrides(yamlText) {
  const entries = [];
  let inBlock = false;

  for (const rawLine of yamlText.split('\n')) {
    if (/^overrides:\s*$/.test(rawLine)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    // Any other top-level key ends the block.
    if (/^\S/.test(rawLine)) break;

    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const separator = findKeyValueSeparator(line);
    if (separator < 0) continue;

    const key = unquote(line.slice(0, separator).trim());
    const value = unquote(line.slice(separator + 1).trim());
    if (!key || !value) continue;

    const { packageName, selector } = splitPackageSelector(key);
    const resolved = resolveAliasTarget(packageName, value);
    entries.push({
      key,
      packageName: resolved.packageName,
      selector,
      range: resolved.range,
    });
  }

  return entries;
}

/** Index of the `:` separating key from value, skipping quoted keys and `@<=1.2.3` selectors. */
function findKeyValueSeparator(line) {
  if (line.startsWith("'") || line.startsWith('"')) {
    const quote = line[0];
    const closing = line.indexOf(quote, 1);
    if (closing < 0) return -1;
    return line.indexOf(':', closing);
  }
  return line.indexOf(':');
}

function unquote(text) {
  if (text.length >= 2 && (text[0] === "'" || text[0] === '"') && text.at(-1) === text[0]) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Split `markdown-it@<=14.1.1` into name + version selector, leaving scopes intact.
 *
 * @param {string} key
 * @returns {{ packageName: string, selector: string | null }}
 */
export function splitPackageSelector(key) {
  const searchFrom = key.startsWith('@') ? 1 : 0;
  const at = key.indexOf('@', searchFrom);
  if (at < 0) return { packageName: key, selector: null };
  return { packageName: key.slice(0, at), selector: key.slice(at + 1) };
}

/** `npm:@jsr/pkg@^1.2.3` aliases resolve against the aliased package, not the key. */
function resolveAliasTarget(packageName, value) {
  if (!value.startsWith('npm:')) return { packageName, range: value };
  const spec = value.slice('npm:'.length);
  const { packageName: aliasName, selector } = splitPackageSelector(spec);
  return { packageName: aliasName, range: selector ?? '*' };
}

/**
 * Highest major version a range can ever resolve to, or null when unbounded
 * (a bare `>=` floor never blocks an upgrade, so it is not a cap).
 *
 * @param {string} range
 * @returns {number | null}
 */
export function cappedMajorFromRange(range) {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') return null;

  const upperBound = /<\s*([\d.]+)/.exec(trimmed);
  if (upperBound) {
    const [rawMajor, rawMinor, rawPatch] = upperBound[1].split('.');
    const major = Number(rawMajor);
    const minor = rawMinor === undefined ? 0 : Number(rawMinor);
    const patch = rawPatch === undefined ? 0 : Number(rawPatch);
    if (!Number.isInteger(major)) return null;
    // `<15` and `<15.0.0` allow up to 14.x; `<15.2.0` still allows 15.x.
    return minor === 0 && patch === 0 ? major - 1 : major;
  }

  const caret = /^[\^~]?\s*(\d+)\./.exec(trimmed);
  if (caret) return Number(caret[1]);

  const bare = /^(\d+)\.\d+/.exec(trimmed);
  if (bare) return Number(bare[1]);

  // `>=1.2.3` and friends have no ceiling.
  return null;
}

export function majorOf(version) {
  const m = /^\D*(\d+)\./.exec(version);
  return m ? Number(m[1]) : null;
}

/**
 * Compare each override's cap against the latest published major.
 *
 * @param {object} args
 * @param {{ key: string, packageName: string, range: string }[]} args.overrides
 * @param {Map<string, string | null>} args.latestByPackage npm `latest` per package (null = lookup failed)
 * @param {Record<string, string>} [args.exceptions]
 * @returns {{ drifts: object[], excepted: object[], skipped: object[] }}
 */
export function evaluateOverrideMajors({
  overrides,
  latestByPackage,
  exceptions = PINNED_MAJOR_EXCEPTIONS,
}) {
  const drifts = [];
  const excepted = [];
  const skipped = [];

  for (const override of overrides) {
    const cap = cappedMajorFromRange(override.range);
    if (cap === null) continue;

    const latest = latestByPackage.get(override.packageName);
    if (!latest) {
      skipped.push({ ...override, reason: 'npm registry lookup unavailable' });
      continue;
    }
    const latestMajor = majorOf(latest);
    if (latestMajor === null) {
      skipped.push({ ...override, reason: `unparsable latest version "${latest}"` });
      continue;
    }
    if (latestMajor <= cap) continue;

    const finding = { ...override, cap, latest, latestMajor };
    const reason = exceptions[override.packageName];
    if (reason) {
      excepted.push({ ...finding, reason });
    } else {
      drifts.push(finding);
    }
  }

  return { drifts, excepted, skipped };
}

/** Latest published version, or null on any network / registry failure. */
async function fetchLatestVersion(packageName) {
  try {
    const res = await fetch(`${REGISTRY}/${encodeURIComponent(packageName)}/latest`, {
      headers: { Accept: 'application/vnd.npm.install-v1+json, application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.version === 'string' ? body.version : null;
  } catch {
    // catch-no-log-ok offline / registry outage is a skip, reported by the caller
    return null;
  }
}

function installedVersion(packageName) {
  try {
    const manifest = path.join(ROOT, 'node_modules', packageName, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    // catch-no-log-ok not installed (or nested only); version is informational
    return null;
  }
}

async function main() {
  console.log('');
  console.log('Checking pinned overrides for newer major versions...');

  if (!fs.existsSync(WORKSPACE_YAML)) {
    console.log('  pnpm-workspace.yaml missing — skip.');
    return 0;
  }

  const overrides = parseOverrides(fs.readFileSync(WORKSPACE_YAML, 'utf8'));
  if (overrides.length === 0) {
    console.log('  No overrides declared — nothing to check.');
    return 0;
  }

  const names = [...new Set(overrides.map((o) => o.packageName))];
  const results = await Promise.all(names.map((name) => fetchLatestVersion(name)));
  const latestByPackage = new Map(names.map((name, i) => [name, results[i]]));

  const { drifts, excepted, skipped } = evaluateOverrideMajors({ overrides, latestByPackage });

  if (skipped.length === names.length && drifts.length === 0) {
    console.log(`  npm registry unreachable (${skipped.length} lookups) — skip.`);
    return 0;
  }

  for (const item of excepted) {
    console.log(
      `  ${item.packageName}: capped at ${item.cap}.x, latest ${item.latest} — expected (${item.reason})`,
    );
  }
  for (const item of skipped) {
    console.log(`  ${item.packageName}: ${item.reason} — skipped`);
  }

  if (drifts.length === 0) {
    console.log('  No unexplained major drift in pinned overrides.');
    return 0;
  }

  for (const item of drifts) {
    const installed = installedVersion(item.packageName) ?? 'not installed at root';
    console.log('');
    console.log(`  Pinned behind a major: ${item.packageName}`);
    console.log(`    override:  ${item.key}: ${item.range} (allows up to ${item.cap}.x)`);
    console.log(`    installed: ${installed}`);
    console.log(`    latest:    ${item.latest}`);
    console.log(`    https://www.npmjs.com/package/${item.packageName}?activeTab=versions`);
    console.log(
      '    Upgrade it, or add the blocking consumer as a reason in PINNED_MAJOR_EXCEPTIONS',
    );
    console.log('    (scripts/check-pinned-majors.mjs) so this stays actionable.');
  }

  return DRIFT_EXIT_CODE;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main());
}
