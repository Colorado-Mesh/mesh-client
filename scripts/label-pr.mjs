/**
 * Automatic pull-request labeling for mesh-client.
 *
 * Derives type / protocol / platform labels from the Conventional Commits title
 * prefix + scope, plus a small set of high-confidence changed paths. Labels are
 * only ever added, never removed, so manually applied labels are preserved.
 *
 * Invoked by .github/workflows/labeler.yaml.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @typedef {{ title?: string, changedFiles?: string[] }} PrInput */

/** Conventional Commits prefix -> type label. */
const TYPE_LABELS = new Map([
  ['feat', 'enhancement'],
  ['fix', 'bug'],
  ['docs', 'documentation'],
  ['chore', 'chore'],
  ['refactor', 'chore'],
  ['test', 'chore'],
  ['perf', 'chore'],
  ['ci', 'chore'],
  ['build', 'chore'],
  ['style', 'chore'],
]);

/** Optional commit scope -> protocol / platform label. */
const SCOPE_LABELS = new Map([
  ['meshtastic', 'meshtastic'],
  ['meshcore', 'meshcore'],
  ['reticulum', 'reticulum'],
  ['win', 'windows'],
  ['windows', 'windows'],
  ['mac', 'macos'],
  ['macos', 'macos'],
  ['linux', 'linux'],
  ['flatpak', 'flatpak'],
]);

/** High-confidence changed-path -> label rules. First match per file wins. */
const PATH_RULES = [
  { pattern: /^reticulum-sidecar\//, label: 'reticulum' },
  { pattern: /^src\/renderer\/lib\/reticulum\//, label: 'reticulum' },
  { pattern: /^src\/renderer\/runtime\/useReticulumRuntime\.ts$/, label: 'reticulum' },
  { pattern: /^src\/main\/ipc\/reticulum-[^/]+\.ts$/, label: 'reticulum' },
  { pattern: /^src\/renderer\/lib\/meshcore\//, label: 'meshcore' },
  { pattern: /^src\/main\/meshcore-mqtt-adapter\.ts$/, label: 'meshcore' },
  { pattern: /^flatpak\//, label: 'flatpak' },
  { pattern: /^\.github\/workflows\/flatpak\.yaml$/, label: 'flatpak' },
];

/**
 * Parses a Conventional Commits title into type + optional scope.
 * Linear scan — avoids nested-quantifier regex (eslint security/detect-unsafe-regex).
 * @param {string} title
 * @returns {{ type: string, scope?: string } | null}
 */
function parseConventionalTitle(title) {
  const typeMatch = /^([a-z]+)/i.exec(title);
  if (!typeMatch) return null;
  let rest = title.slice(typeMatch[0].length);
  /** @type {string | undefined} */
  let scope;
  if (rest.startsWith('(')) {
    const close = rest.indexOf(')');
    if (close === -1) return null;
    scope = rest.slice(1, close);
    rest = rest.slice(close + 1);
  }
  if (rest.startsWith('!')) rest = rest.slice(1);
  if (!rest.startsWith(':')) return null;
  return { type: typeMatch[1].toLowerCase(), scope: scope?.toLowerCase() };
}

/**
 * Computes the labels to add for a pull request.
 * @param {PrInput} input
 * @returns {string[]} sorted, de-duplicated label names (may be empty)
 */
export function computeLabels({ title = '', changedFiles = [] } = {}) {
  const labels = new Set();

  const parsed = parseConventionalTitle(title);
  if (parsed) {
    const type = TYPE_LABELS.get(parsed.type);
    if (type) labels.add(type);
    if (parsed.scope) {
      const scoped = SCOPE_LABELS.get(parsed.scope);
      if (scoped) labels.add(scoped);
    }
  }

  for (const file of changedFiles) {
    for (const rule of PATH_RULES) {
      if (rule.pattern.test(file)) {
        labels.add(rule.label);
        break;
      }
    }
  }

  return [...labels].sort();
}

/** Lists changed file names for a PR via the GitHub CLI. */
function listChangedFiles(repo, prNumber) {
  const result = spawnSync(
    'gh',
    ['api', `repos/${repo}/pulls/${prNumber}/files`, '--paginate', '--jq', '.[].filename'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`gh api failed (status ${String(result.status)})`);
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const title = process.env.PR_TITLE ?? '';
  if (!repo || !prNumber) {
    process.stderr.write('GITHUB_REPOSITORY and PR_NUMBER are required\n');
    process.exitCode = 1;
    return;
  }

  const labels = computeLabels({ title, changedFiles: listChangedFiles(repo, prNumber) });
  if (labels.length === 0) {
    process.stdout.write('label-pr: no labels matched\n');
    return;
  }

  const args = ['pr', 'edit', prNumber, '--repo', repo];
  for (const label of labels) args.push('--add-label', label);
  const edit = spawnSync('gh', args, { stdio: 'inherit' });
  if (edit.status !== 0) {
    process.exitCode = edit.status ?? 1;
    return;
  }
  process.stdout.write(`label-pr: added ${labels.join(', ')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
