#!/usr/bin/env node
/**
 * Promotion Doctor: the required check on pull requests to `main`.
 *
 *   pnpm run promotion:doctor -- --pr <number> [--require-green-checks] [--wait-for-checks]
 *     [--timeout-minutes 150] [--poll-seconds 30] [--repo owner/name] [--remote origin]
 *
 * Promotions (title "Promote staging to main ...") must be one merge commit whose parents are
 * the current `main` and a `staging` snapshot, with exactly that snapshot's files, consistent
 * release metadata, release notes that cover every shipped pull request, and green checks.
 * `hotfix/*` pull requests get lighter checks. Anything else is asked to target `staging`.
 * In Actions the workflow runs this from the trusted base commit; the pull request's code is
 * only ever read as git objects, never checked out or executed.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { detectReleaseBump } from './detectReleaseBump.mjs';
import { parseTopReleaseVersion } from './metainfoRelease.mjs';
import {
  changedPaths,
  commitsInRange,
  fetchRefs,
  git,
  isAncestor,
  latestReleaseTag,
  revParse,
  showFile,
  treeOf,
} from './promotionGit.mjs';
import { createGithubApi, resolveRepo, resolveToken } from './promotionGithub.mjs';
import {
  extractSection,
  isBookkeepingSubject,
  prNumberFromSubject,
  PROMOTION_TITLE_PREFIX,
  RELEASE_NOTES_HEADING,
  SCHEMA_HEADING,
} from './promotionNotes.mjs';
import {
  compareVersions,
  METAINFO_PATH,
  PACKAGE_JSON_PATH,
  parseSchemaVersion,
  readPackageVersion,
  resolveNextVersion,
  SCHEMA_SOURCE_PATH,
} from './releaseVersion.mjs';

export const DOCTOR_CHECK_NAME = 'Promotion Doctor';
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const REBUILD = 'rebuild it with pnpm run promotion:open';

/** @typedef {{ name: string, status: 'pass'|'fail'|'warn'|'info', detail: string }} Result */

const pass = (name, detail) => ({ name, status: 'pass', detail });
const fail = (name, detail) => ({ name, status: 'fail', detail });
const warn = (name, detail) => ({ name, status: 'warn', detail });
const info = (name, detail) => ({ name, status: 'info', detail });
const short = (sha) => String(sha).slice(0, 7);

/**
 * @param {{ title: string, head: { ref: string } }} pr
 * @param {{ stagingExists: boolean }} options
 * @returns {'transition'|'promotion'|'hotfix'|'other'}
 */
export function classifyPullRequest(pr, { stagingExists }) {
  if (!stagingExists) return 'transition';
  if (pr.title.trim().toLowerCase().startsWith(PROMOTION_TITLE_PREFIX.toLowerCase())) {
    return 'promotion';
  }
  if (pr.head.ref.startsWith('hotfix/')) return 'hotfix';
  return 'other';
}

/** @param {string} cwd @param {string} sha @returns {string[]} */
function parentsOf(cwd, sha) {
  return git(cwd, ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
}

/**
 * @param {{ cwd: string, headSha: string, mainSha: string, stagingSha: string }} input
 * @returns {Result[]}
 */
export function checkPromotionShape({ cwd, headSha, mainSha, stagingSha }) {
  const parents = parentsOf(cwd, headSha);
  if (parents.length !== 2) {
    return [
      fail(
        'Promotion commit',
        `Head ${short(headSha)} has ${parents.length} parent(s); a promotion is one merge commit of main and staging. ${REBUILD}.`,
      ),
    ];
  }
  const [first, snapshot] = parents;
  const results = [pass('Promotion commit', 'Head is one merge commit of main and staging.')];
  results.push(
    first === mainSha
      ? pass('Built on current main', `First parent is main at ${short(mainSha)}.`)
      : fail(
          'Built on current main',
          `First parent ${short(first)} is not the main tip ${short(mainSha)}; ${REBUILD}.`,
        ),
  );
  if (!isAncestor(cwd, snapshot, stagingSha)) {
    results.push(
      fail('Staging snapshot', `Second parent ${short(snapshot)} is not a commit staging has.`),
    );
  } else if (isAncestor(cwd, snapshot, mainSha)) {
    results.push(fail('Staging snapshot', `Staging ${short(snapshot)} is already in main.`));
  } else {
    results.push(pass('Staging snapshot', `Ships staging at ${short(snapshot)}.`));
    const newer = Number(git(cwd, ['rev-list', '--count', `${snapshot}..${stagingSha}`]));
    if (newer > 0) {
      results.push(
        info(
          'Staging moved on',
          `${newer} newer staging commit(s) will ship in the next promotion; ${REBUILD} to include them now.`,
        ),
      );
    }
  }
  if (treeOf(cwd, headSha) === treeOf(cwd, snapshot)) {
    results.push(
      pass('Same files as staging', `Files are identical to staging ${short(snapshot)}.`),
    );
  } else {
    const paths = changedPaths(cwd, snapshot, headSha);
    results.push(
      fail(
        'Same files as staging',
        `Files differ from staging ${short(snapshot)}: ${paths.slice(0, 20).join(', ')}${paths.length > 20 ? ', ...' : ''}. Land fixes on staging and ${REBUILD}.`,
      ),
    );
  }
  return results;
}

/**
 * @param {{ cwd: string, headSha: string, latestTag: string, tagExists: boolean }} input
 * @returns {Result[]}
 */
export function checkReleaseVersion({ cwd, headSha, latestTag, tagExists }) {
  const version = readPackageVersion(showFile(cwd, headSha, PACKAGE_JSON_PATH));
  const latest = latestTag.slice(1);
  const results = [];
  if (version === latest) {
    results.push(info('Release', `No release: version stays ${version}, so merging does not tag.`));
  } else if (compareVersions(version, latest) < 0) {
    results.push(
      fail(
        'Release version',
        `package.json ${version} is lower than the latest release ${latest}.`,
      ),
    );
  } else if (tagExists) {
    results.push(
      fail('Release version', `v${version} is already tagged; ${REBUILD} for a new version.`),
    );
  } else {
    results.push(pass('Release version', `Merging releases v${version} (latest is ${latest}).`));
  }
  const top = parseTopReleaseVersion(showFile(cwd, headSha, METAINFO_PATH));
  results.push(
    top === version
      ? pass('Flatpak MetaInfo', `Top release entry is ${version}.`)
      : fail(
          'Flatpak MetaInfo',
          `Top <release> in ${METAINFO_PATH} is ${top ?? 'missing'} but package.json is ${version}.`,
        ),
  );
  if (version !== latest) {
    const shipped = commitsInRange(cwd, `${latestTag}..${headSha}`, { noMerges: true }).filter(
      (commit) => !isBookkeepingSubject(commit.subject),
    );
    const detected = detectReleaseBump(
      shipped.map((commit) => commit.subject),
      shipped.map((commit) => commit.body).join('\n'),
    );
    const predicted = resolveNextVersion({ latestVersion: latest, bump: 'auto', detected });
    if (predicted !== version) {
      results.push(
        warn(
          'Version choice',
          `Commit titles suggest ${predicted} (${detected}); this promotion releases ${version}.`,
        ),
      );
    }
  }
  return results;
}

/**
 * @param {{ body: string, commits: Array<{ subject: string }> }} input
 * @returns {Result[]}
 */
export function checkReleaseNotes({ body, commits }) {
  const section = extractSection(body ?? '', RELEASE_NOTES_HEADING);
  if (!section) {
    return [
      fail(
        'Release notes',
        `The pull request body needs a "${RELEASE_NOTES_HEADING}" section; pnpm run promotion:open writes one.`,
      ),
    ];
  }
  const required = [
    ...new Set(
      commits
        .filter((commit) => !isBookkeepingSubject(commit.subject))
        .map((commit) => prNumberFromSubject(commit.subject))
        .filter((number) => number !== null),
    ),
  ];
  const mentioned = new Set((section.match(/#\d+/g) ?? []).map((ref) => Number(ref.slice(1))));
  const missing = required.filter((number) => !mentioned.has(number));
  return missing.length > 0
    ? [
        fail(
          'Release notes',
          `Missing shipped pull request(s): ${missing.map((number) => `#${number}`).join(', ')}.`,
        ),
      ]
    : [pass('Release notes', `Covers all ${required.length} shipped pull request(s).`)];
}

/**
 * @param {{ body: string, schemaMain: number, schemaHead: number }} input
 * @returns {Result[]}
 */
export function checkSchemaCallout({ body, schemaMain, schemaHead }) {
  if (schemaMain === schemaHead) return [pass('Database schema', `Unchanged (${schemaMain}).`)];
  const section = extractSection(body ?? '', SCHEMA_HEADING) ?? '';
  const numbers = new Set((section.match(/\d+/g) ?? []).map(Number));
  return numbers.has(schemaMain) && numbers.has(schemaHead)
    ? [pass('Database schema', `The ${schemaMain} -> ${schemaHead} upgrade is called out.`)]
    : [
        fail(
          'Database schema',
          `The schema changes from ${schemaMain} to ${schemaHead}; say so under "${SCHEMA_HEADING}" (the upgrade is one-way).`,
        ),
      ];
}

/**
 * @param {{
 *   cwd: string, headSha: string, mainSha: string, stagingSha: string, body: string,
 *   latestTag: string, tagExists: boolean,
 * }} input
 * @returns {Result[]}
 */
export function checkHotfix({ cwd, headSha, mainSha, stagingSha, body, latestTag, tagExists }) {
  const results = [
    isAncestor(cwd, mainSha, headSha)
      ? pass('Up to date with main', `Built on main at ${short(mainSha)}.`)
      : fail('Up to date with main', 'Update the hotfix branch from main.'),
  ];
  const stagingOnly = new Set(
    git(cwd, ['rev-list', `${mainSha}..${stagingSha}`])
      .split('\n')
      .filter(Boolean),
  );
  const added = git(cwd, ['rev-list', `${mainSha}..${headSha}`])
    .split('\n')
    .filter(Boolean);
  const carried = added.filter((sha) => stagingOnly.has(sha));
  results.push(
    carried.length > 0
      ? fail(
          'No staging work',
          `The hotfix carries ${carried.length} commit(s) that are on staging but not main; cut it from main, or promote staging instead.`,
        )
      : pass('No staging work', 'Only hotfix commits on top of main.'),
  );
  const mainVersion = readPackageVersion(showFile(cwd, mainSha, PACKAGE_JSON_PATH));
  const headVersion = readPackageVersion(showFile(cwd, headSha, PACKAGE_JSON_PATH));
  if (headVersion === mainVersion) {
    results.push(info('Release', 'No version change, so merging does not tag a release.'));
  } else {
    results.push(...checkReleaseVersion({ cwd, headSha, latestTag, tagExists }));
    if (!extractSection(body ?? '', RELEASE_NOTES_HEADING)) {
      results.push(
        fail(
          'Release notes',
          `This hotfix releases ${headVersion}; add a "${RELEASE_NOTES_HEADING}" section for the draft release.`,
        ),
      );
    }
  }
  results.push(
    info(
      'Back-port',
      'After merging, run pnpm run promotion:backport so staging gets this fix; the next promotion needs it.',
    ),
  );
  return results;
}

/**
 * @param {{
 *   checkRuns: Array<{ id: number, name: string, status: string, conclusion: string | null, app?: { id?: number } }>,
 *   statuses: Array<{ context: string, state: string }>,
 *   selfName: string,
 * }} input
 */
export function summarizeChecks({ checkRuns, statuses, selfName }) {
  /** @type {Map<string, (typeof checkRuns)[number]>} */
  const latest = new Map();
  for (const run of checkRuns) {
    if (run.name === selfName) continue;
    const key = `${run.app?.id ?? 'unknown'}:${run.name}`;
    const current = latest.get(key);
    if (!current || run.id > current.id) latest.set(key, run);
  }
  const summary = { pending: [], failing: [], passing: [] };
  for (const run of latest.values()) {
    if (run.status !== 'completed') summary.pending.push(run.name);
    else if (PASSING_CONCLUSIONS.has(run.conclusion)) summary.passing.push(run.name);
    else summary.failing.push(`${run.name} (${run.conclusion})`);
  }
  for (const status of statuses) {
    if (status.context === selfName) continue;
    if (status.state === 'success') summary.passing.push(status.context);
    else if (status.state === 'pending') summary.pending.push(status.context);
    else summary.failing.push(`${status.context} (${status.state})`);
  }
  return summary;
}

/**
 * @param {{ kind: string, results: Result[] }} report
 * @returns {string}
 */
export function renderSummary({ kind, results }) {
  const cell = (text) => String(text).replaceAll('|', '\\|').replace(/\r?\n/g, ' ');
  return [
    `### ${DOCTOR_CHECK_NAME}: ${kind}`,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |',
    ...results.map(
      (result) =>
        `| ${cell(result.name)} | ${result.status.toUpperCase()} | ${cell(result.detail)} |`,
    ),
    '',
  ].join('\n');
}

/**
 * @param {{
 *   api: ReturnType<typeof createGithubApi>, headSha: string, waitForChecks: boolean,
 *   timeoutMs: number, pollMs: number, sleep: (ms: number) => Promise<void>, now: () => number,
 * }} input
 * @returns {Promise<{ result: Result, waited: boolean }>}
 */
async function waitForGreenChecks({ api, headSha, waitForChecks, timeoutMs, pollMs, sleep, now }) {
  const deadline = now() + timeoutMs;
  let waited = false;
  for (;;) {
    const summary = summarizeChecks({
      checkRuns: await api.listCheckRuns(headSha),
      statuses: await api.combinedStatuses(headSha),
      selfName: DOCTOR_CHECK_NAME,
    });
    if (summary.failing.length > 0) {
      return { result: fail('Checks', `Failing: ${summary.failing.join(', ')}.`), waited };
    }
    if (summary.pending.length === 0) {
      return { result: pass('Checks', `${summary.passing.length} check(s) green.`), waited };
    }
    if (!waitForChecks || now() >= deadline) {
      return { result: fail('Checks', `Still pending: ${summary.pending.join(', ')}.`), waited };
    }
    await sleep(pollMs);
    waited = true;
  }
}

/**
 * @param {{
 *   prNumber: number, cwd: string, api: ReturnType<typeof createGithubApi>, remote: string,
 *   token?: string, requireGreenChecks: boolean, waitForChecks: boolean, timeoutMs: number,
 *   pollMs: number, sleep?: (ms: number) => Promise<void>, now?: () => number,
 * }} options
 * @returns {Promise<{ ok: boolean, kind: string, results: Result[] }>}
 */
export async function runDoctor({
  prNumber,
  cwd,
  api,
  remote,
  token,
  requireGreenChecks,
  waitForChecks,
  timeoutMs,
  pollMs,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const pr = await api.getPull(prNumber);
  const mainSha = await api.branchSha('main');
  const stagingSha = await api.branchSha('staging');
  const kind = classifyPullRequest(pr, { stagingExists: Boolean(stagingSha) });
  const done = (results) => ({
    ok: !results.some((result) => result.status === 'fail'),
    kind,
    results,
  });

  if (kind === 'transition') {
    return done([
      info(
        'Transition',
        'staging does not exist yet, so main keeps its current flow. This check starts enforcing once staging is created.',
      ),
    ]);
  }
  if (kind === 'other') {
    return done([
      fail(
        'Pull request target',
        `Pull requests to main are promotions ("${PROMOTION_TITLE_PREFIX} ...", opened by pnpm run promotion:open) or hotfix/* branches. Retarget this one to staging.`,
      ),
    ]);
  }
  if (pr.head.repo?.full_name !== pr.base.repo?.full_name) {
    return done([
      fail(
        'Head repository',
        'Promotions and hotfixes must come from a branch in this repository.',
      ),
    ]);
  }

  /** @type {Result[]} */
  const results = [];
  if (pr.draft) {
    results.push(
      fail(
        'Ready for review',
        'Draft pull requests are not ready; mark it ready for review and the Doctor runs again.',
      ),
    );
  }
  fetchRefs(
    cwd,
    remote,
    [
      `+refs/heads/main:refs/remotes/${remote}/main`,
      `+refs/heads/staging:refs/remotes/${remote}/staging`,
      `+refs/pull/${prNumber}/head:refs/remotes/${remote}/pull/${prNumber}`,
      '+refs/tags/v*:refs/tags/v*',
    ],
    { token },
  );
  const headSha = pr.head.sha;
  try {
    revParse(cwd, headSha);
  } catch {
    // catch-no-log-ok the head was force-pushed after the event; the new push gets its own run
    results.push(
      fail('Head moved', `Head ${short(headSha)} is gone; the newer push is checked separately.`),
    );
    return done(results);
  }
  const latestTag = latestReleaseTag(cwd, mainSha);
  if (!latestTag) {
    results.push(fail('Release tag', 'No vX.Y.Z release tag is reachable from main.'));
    return done(results);
  }
  const headVersion = readPackageVersion(showFile(cwd, headSha, PACKAGE_JSON_PATH));
  const tagExists = await api.tagExists(`v${headVersion}`);

  if (kind === 'promotion') {
    results.push(...checkPromotionShape({ cwd, headSha, mainSha, stagingSha }));
    results.push(...checkReleaseVersion({ cwd, headSha, latestTag, tagExists }));
    const parents = parentsOf(cwd, headSha);
    if (parents.length === 2) {
      results.push(
        ...checkReleaseNotes({
          body: pr.body ?? '',
          commits: commitsInRange(cwd, `${mainSha}..${parents[1]}`, { noMerges: true }),
        }),
      );
    }
    results.push(
      ...checkSchemaCallout({
        body: pr.body ?? '',
        schemaMain: parseSchemaVersion(showFile(cwd, mainSha, SCHEMA_SOURCE_PATH)),
        schemaHead: parseSchemaVersion(showFile(cwd, headSha, SCHEMA_SOURCE_PATH)),
      }),
    );
  } else {
    results.push(
      ...checkHotfix({
        cwd,
        headSha,
        mainSha,
        stagingSha,
        body: pr.body ?? '',
        latestTag,
        tagExists,
      }),
    );
  }

  if (!requireGreenChecks || results.some((result) => result.status === 'fail')) {
    return done(results);
  }
  const checks = await waitForGreenChecks({
    api,
    headSha,
    waitForChecks,
    timeoutMs,
    pollMs,
    sleep,
    now,
  });
  results.push(checks.result);
  if (checks.waited && checks.result.status === 'pass') {
    const freshMain = await api.branchSha('main');
    if (freshMain !== mainSha) {
      results.push(
        fail('Main moved', `main moved to ${short(freshMain)} while the checks ran; ${REBUILD}.`),
      );
    }
  }
  return done(results);
}

const escapeData = (text) =>
  String(text).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const escapeProperty = (text) => escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');

/** @param {string[]} argv */
function parseCliArgs(argv) {
  const options = {
    pr: NaN,
    requireGreenChecks: false,
    waitForChecks: false,
    timeoutMinutes: 150,
    pollSeconds: 30,
    repo: undefined,
    remote: 'origin',
  };
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inline] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => (inline !== undefined ? inline : args[++index]);
    if (flag === '--pr') options.pr = Number(value());
    else if (flag === '--timeout-minutes') options.timeoutMinutes = Number(value());
    else if (flag === '--poll-seconds') options.pollSeconds = Number(value());
    else if (flag === '--repo') options.repo = value();
    else if (flag === '--remote') options.remote = value();
    else if (arg === '--require-green-checks') options.requireGreenChecks = true;
    else if (arg === '--wait-for-checks') options.waitForChecks = true;
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}`);
  }
  if (!Number.isInteger(options.pr) || options.pr <= 0)
    throw new Error('--pr <number> is required');
  return options;
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      'Usage: pnpm run promotion:doctor -- --pr <number> [--require-green-checks] [--wait-for-checks] [--timeout-minutes 150] [--poll-seconds 30] [--repo owner/name]',
    );
    process.exit(2);
  }
  const cwd = process.cwd();
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  const token = resolveToken({
    env: process.env,
    ghTokenFn: () => {
      try {
        return execFileSync('gh', ['auth', 'token'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // catch-no-log-ok gh is missing or signed out; resolveToken explains what to set
        return '';
      }
    },
  });
  const repo = resolveRepo({ env: process.env, argRepo: options.repo, cwd });
  const report = await runDoctor({
    prNumber: options.pr,
    cwd,
    api: createGithubApi({ token, repo }),
    remote: options.remote,
    token: inActions ? token : undefined,
    requireGreenChecks: options.requireGreenChecks,
    waitForChecks: options.waitForChecks,
    timeoutMs: options.timeoutMinutes * 60_000,
    pollMs: options.pollSeconds * 1000,
  });

  console.info(`${DOCTOR_CHECK_NAME}: ${report.kind} pull request #${options.pr} in ${repo}`);
  for (const result of report.results) {
    console.info(`${result.status.toUpperCase().padEnd(4)} ${result.name}: ${result.detail}`);
    if (inActions && (result.status === 'fail' || result.status === 'warn')) {
      const command = result.status === 'fail' ? 'error' : 'warning';
      console.info(
        `::${command} title=${escapeProperty(result.name)}::${escapeData(result.detail)}`,
      );
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderSummary(report));
  }
  console.info(report.ok ? 'Promotion Doctor passed.' : 'Promotion Doctor failed.');
  process.exitCode = report.ok ? 0 : 1;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
