/**
 * Conventional Commits → semver bump for mesh-client releases.
 *
 * Matches `type:`, `type(scope):`, and breaking `type!:` / `type(scope)!:`
 * (the historical bash regex only matched unscoped `type:` and missed squash
 * titles like `feat(rrc): …`, so auto-detect often returned patch for minors).
 */

/** @typedef {'major' | 'minor' | 'patch'} ReleaseBump */

const RELEASE_TYPES = new Set([
  'feat',
  'fix',
  'chore',
  'docs',
  'refactor',
  'test',
  'style',
  'perf',
  'build',
  'ci',
]);

/**
 * Parse Conventional Commit type / breaking bang from a subject line.
 * @param {string} subject
 * @returns {{ type: string, breakingBang: boolean } | null}
 */
export function parseConventionalSubject(subject) {
  const trimmed = subject.trim();
  const colon = trimmed.indexOf(':');
  if (colon <= 0) return null;
  // Require conventional "type: " / "type(scope): " (space after colon is usual;
  // allow missing space for robustness).
  let head = trimmed.slice(0, colon);
  let breakingBang = false;
  if (head.endsWith('!')) {
    breakingBang = true;
    head = head.slice(0, -1);
  }
  let type = head;
  const open = head.indexOf('(');
  if (open !== -1) {
    if (!head.endsWith(')')) return null;
    type = head.slice(0, open);
  }
  type = type.toLowerCase();
  if (!RELEASE_TYPES.has(type)) return null;
  return { type, breakingBang };
}

/**
 * @param {string[]} subjects - commit subjects only (one per commit)
 * @param {string} [bodiesJoined] - concatenated commit bodies (for BREAKING CHANGE footers)
 * @returns {ReleaseBump}
 */
export function detectReleaseBump(subjects, bodiesJoined = '') {
  let hasBreaking = bodiesJoined.includes('BREAKING CHANGE:');
  let hasFeat = false;
  let hasOther = false;

  for (const raw of subjects) {
    const parsed = parseConventionalSubject(raw);
    if (!parsed) continue;
    if (parsed.breakingBang) hasBreaking = true;
    if (parsed.type === 'feat') hasFeat = true;
    hasOther = true;
  }

  if (hasBreaking) return 'major';
  if (hasFeat) return 'minor';
  if (hasOther) return 'patch';
  return 'patch';
}

/**
 * @param {string} currentVersion - X.Y.Z
 * @param {ReleaseBump | string} bump - patch|minor|major|or exact X.Y.Z
 * @returns {string} next X.Y.Z
 */
export function previewNextVersion(currentVersion, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const parts = currentVersion.split('.').map((n) => Number(n));
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }
  let [major, minor, patch] = parts;
  if (bump === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor += 1;
    patch = 0;
  } else if (bump === 'patch') {
    patch += 1;
  } else {
    throw new Error(`Invalid bump: ${bump}`);
  }
  return `${major}.${minor}.${patch}`;
}

/**
 * CLI: node scripts/detectReleaseBump.mjs --since vX.Y.Z [--current X.Y.Z]
 * Prints bump (and optionally next version) as JSON on stdout.
 */
async function main() {
  const args = process.argv.slice(2);
  let since = '';
  let current = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since') since = args[++i] ?? '';
    else if (args[i] === '--current') current = args[++i] ?? '';
  }
  if (!since) {
    console.error('Usage: node scripts/detectReleaseBump.mjs --since <tag> [--current X.Y.Z]');
    process.exit(2);
  }

  const { execFileSync } = await import('node:child_process');
  const subjectsRaw = execFileSync('git', ['log', `${since}..HEAD`, '--pretty=format:%s'], {
    encoding: 'utf8',
  });
  const bodiesRaw = execFileSync('git', ['log', `${since}..HEAD`, '--pretty=format:%b'], {
    encoding: 'utf8',
  });
  const subjects = subjectsRaw.split('\n').filter(Boolean);
  const bump = detectReleaseBump(subjects, bodiesRaw);
  /** @type {{ bump: ReleaseBump; subjectCount: number; nextVersion?: string }} */
  const out = { bump, subjectCount: subjects.length };
  if (current) out.nextVersion = previewNextVersion(current, bump);
  process.stdout.write(`${JSON.stringify(out)}\n`);
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('detectReleaseBump.mjs') ||
    process.argv[1].endsWith('detectReleaseBump.js'));
if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
