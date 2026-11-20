/**
 * Release notes and release pull request text for `pnpm run release:open` and the release tag
 * plan. Pure string functions.
 */
import { bodyHasBreakingChange, parseConventionalSubject } from './detectReleaseBump.mjs';

export const RELEASE_NOTES_HEADING = '## Release notes';
export const SCHEMA_HEADING = '## Database schema';
/** A release commit as `release:open` writes it. */
export const RELEASE_SUBJECT_RE = /^chore: release v\d+\.\d+\.\d+$/;
/** The same commit as the squash merge queue lands it on main. */
const SQUASHED_RELEASE_SUBJECT_RE = /^chore: release v\d+\.\d+\.\d+ \(#\d+\)$/;

const NOTE_SECTIONS = [
  ['breaking', 'Breaking changes'],
  ['features', 'Features'],
  ['fixes', 'Fixes'],
  ['other', 'Other changes'],
];

const RISK_RULES = [
  {
    message: 'GitHub Actions workflows or actions changed',
    matches: (file) => file.startsWith('.github/workflows/') || file.startsWith('.github/actions/'),
  },
  {
    message: 'Dependencies changed (package.json, lockfile or patches)',
    matches: (file) =>
      ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].includes(file) ||
      file.startsWith('patches/'),
  },
  {
    message: 'Reticulum sidecar changed',
    matches: (file) => file.startsWith('reticulum-sidecar/'),
  },
  {
    message: 'Native helpers changed',
    matches: (file) => file.startsWith('native/'),
  },
  {
    message: 'Database code changed',
    matches: (file) =>
      ['src/main/database.ts', 'src/main/db-schema-sync.ts', 'src/main/db-compat.ts'].includes(
        file,
      ),
  },
  {
    message: 'Flatpak packaging changed',
    matches: (file) => file.startsWith('flatpak/') || file === 'org.coloradomesh.MeshClient.yml',
  },
  {
    message: 'Release or packaging configuration changed',
    matches: (file) =>
      file === 'electron-builder.yml' ||
      file === 'scripts/release.sh' ||
      file.startsWith('.github/rulesets/'),
  },
];

/**
 * @param {string} subject
 * @returns {number | null} the `(#N)` number a squash merge appends
 */
export function prNumberFromSubject(subject) {
  const match = /\(#(\d+)\)\s*$/.exec(subject);
  return match ? Number(match[1]) : null;
}

/**
 * Release commits made by the tooling, which never belong in release notes.
 * @param {string} subject
 * @returns {boolean}
 */
export function isBookkeepingSubject(subject) {
  const trimmed = subject.trim();
  return RELEASE_SUBJECT_RE.test(trimmed) || SQUASHED_RELEASE_SUBJECT_RE.test(trimmed);
}

/**
 * @param {Array<{ subject: string, body?: string }>} commits
 * @returns {string} markdown with `###` sections
 */
export function buildReleaseNotes(commits) {
  /** @type {Record<string, string[]>} */
  const sections = { breaking: [], features: [], fixes: [], other: [] };
  for (const { subject, body = '' } of commits) {
    const line = subject.trim();
    if (!line || isBookkeepingSubject(line)) continue;
    const parsed = parseConventionalSubject(line);
    if (parsed?.breakingBang || bodyHasBreakingChange(body)) sections.breaking.push(line);
    else if (parsed?.type === 'feat') sections.features.push(line);
    else if (parsed?.type === 'fix') sections.fixes.push(line);
    else sections.other.push(line);
  }
  const blocks = NOTE_SECTIONS.filter(([key]) => sections[key].length > 0).map(
    ([key, title]) => `### ${title}\n\n${sections[key].map((line) => `- ${line}`).join('\n')}`,
  );
  return blocks.length > 0 ? blocks.join('\n\n') : 'No user-facing changes.';
}

/**
 * @param {string} markdown
 * @param {string} heading - a full `## ` heading line
 * @returns {string | null} the section text, trimmed, or null when the heading is absent
 */
export function extractSection(markdown, heading) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

/**
 * @param {string[]} paths
 * @returns {string[]} one message per risky category touched, in a fixed order
 */
export function riskCallouts(paths) {
  return RISK_RULES.filter((rule) => paths.some((file) => rule.matches(file))).map(
    (rule) => rule.message,
  );
}

/**
 * @param {number} mainVersion
 * @param {number} headVersion
 * @returns {string}
 */
export function schemaSummary(mainVersion, headVersion) {
  if (mainVersion === headVersion) return `Unchanged (schema ${mainVersion}).`;
  if (headVersion > mainVersion) {
    return `Upgrades from ${mainVersion} to ${headVersion} (one-way: builds older than this release cannot open an upgraded database).`;
  }
  return `Goes back from ${mainVersion} to ${headVersion}; check this before merging.`;
}

/**
 * The release pull request title, which the squash merge turns into the release commit subject.
 * @param {string} version
 * @returns {string}
 */
export function releaseTitle(version) {
  return `chore: release v${version}`;
}

/**
 * @param {{
 *   notes: string,
 *   fromVersion: string,
 *   toVersion: string,
 *   bumpReason: string,
 *   schemaFrom: number,
 *   schemaTo: number,
 *   risks: string[],
 *   mainSha: string,
 *   since: string,
 * }} input - `since` names what the notes count from (the latest tag, or a release waiting for one)
 * @returns {string}
 */
export function buildReleaseBody({
  notes,
  fromVersion,
  toVersion,
  bumpReason,
  schemaFrom,
  schemaTo,
  risks,
  mainSha,
  since,
}) {
  const riskText =
    risks.length > 0 ? risks.map((risk) => `- ${risk}`).join('\n') : 'None detected.';
  return [
    RELEASE_NOTES_HEADING,
    '',
    notes,
    '',
    '## Version',
    '',
    `${fromVersion} -> ${toVersion} (${bumpReason})`,
    '',
    SCHEMA_HEADING,
    '',
    schemaSummary(schemaFrom, schemaTo),
    '',
    '## Risk callouts',
    '',
    riskText,
    '',
    '## Release',
    '',
    `Built by \`pnpm run release:open\` from \`main\` at \`${mainSha.slice(0, 7)}\`, with the changes since \`${since}\`. Edit the release notes above if they need it: Cut release reads them when it tags the merged commit. Electron E2E on Linux, macOS and Windows and the release preflight run on this pull request, and the required \`Release gates\` check passes only when all of them do. Run \`pnpm run release:open\` again to rebuild this pull request on a newer \`main\`.`,
    '',
  ].join('\n');
}
