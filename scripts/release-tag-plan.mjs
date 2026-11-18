#!/usr/bin/env node
/**
 * Decide whether a commit on main releases, for `.github/workflows/cut-release.yaml`.
 *
 *   node scripts/release-tag-plan.mjs --sha <sha> [--notes-file <path>] [--require-tag] [--repo owner/name]
 *
 * A commit releases when its package.json version is newer than the latest release tag, has no
 * tag yet, and matches the Flatpak MetaInfo top entry. It is tagged only when the release gates
 * (scripts/releaseGates.mjs) passed on its exact tree: on the commit itself, or on the head of
 * the release pull request merged as it when that head holds the same tree. Only check runs that
 * GitHub Actions made for e2e.yaml count. A pull request's checks ran before the merge, so when
 * anything else reached main first the trees differ and the plan blocks (exit 1) until the gates
 * pass on main. The release notes come from the "## Release notes" section of the merged release
 * pull request, or from conventional commit titles otherwise. Writes `should_tag`, `version`,
 * `tag` and (when tagging) multi-line `notes` to GITHUB_OUTPUT.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parseTopReleaseVersion } from './metainfoRelease.mjs';
import { commitsInRange, latestReleaseTag, showFile } from './releaseGit.mjs';
import { evaluateGates, gateMatchesName, REQUIRED_GATES } from './releaseGates.mjs';
import { createGithubApi, resolveRepo, resolveToken } from './releaseGithub.mjs';
import {
  buildReleaseNotes,
  extractSection,
  RELEASE_NOTES_HEADING,
  releaseTitle,
} from './releaseNotes.mjs';
import {
  compareVersions,
  METAINFO_PATH,
  PACKAGE_JSON_PATH,
  readPackageVersion,
} from './releaseVersion.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * @typedef {{
 *   tagExists: (tag: string) => Promise<boolean>,
 *   pullsForCommit: (sha: string) => Promise<Array<{
 *     title?: string | null,
 *     merge_commit_sha?: string | null,
 *     body?: string | null,
 *     head?: { sha?: string } | null,
 *   }>>,
 *   commitTreeSha: (sha: string) => Promise<string>,
 *   listCheckRuns: (sha: string) => Promise<import('./releaseGates.mjs').CheckRun[]>,
 *   workflowPathForCheckSuite: (checkSuiteId: number) => Promise<string | null>,
 * }} PlanApi
 */

/**
 * The release gates on the tree of `sha`, read from the commit itself and from the merged pull
 * request's head when that head holds the same tree. Each gate-named check run is matched to the
 * workflow file behind its check suite (one lookup per suite), so only e2e.yaml's runs count.
 * @param {{ sha: string, head: string | undefined, api: PlanApi }} input
 * @returns {Promise<{ ok: boolean, notPassed: string[] }>}
 */
async function gatesOnTree({ sha, head, api }) {
  const commits = [sha];
  if (head && head !== sha) {
    const [tree, headTree] = await Promise.all([api.commitTreeSha(sha), api.commitTreeSha(head)]);
    if (headTree === tree) commits.push(head);
  }
  const runs = (await Promise.all(commits.map((commit) => api.listCheckRuns(commit)))).flat();
  const gateRuns = runs.filter((run) =>
    REQUIRED_GATES.some((gate) => gateMatchesName(gate, run.name)),
  );
  const suites = [
    ...new Set(gateRuns.map((run) => run.check_suite?.id).filter((id) => id != null)),
  ];
  const paths = new Map(
    await Promise.all(suites.map(async (id) => [id, await api.workflowPathForCheckSuite(id)])),
  );
  return evaluateGates(
    gateRuns.map((run) => ({ ...run, workflowPath: paths.get(run.check_suite?.id) ?? null })),
  );
}

/**
 * @param {{ cwd: string, sha: string, api: PlanApi }} input
 * @returns {Promise<{
 *   shouldTag: boolean,
 *   blocked: boolean,
 *   version: string,
 *   tag: string,
 *   reason: string,
 *   notes: string,
 * }>} `blocked` when the commit releases but its gates have not passed
 */
export async function planReleaseTag({ cwd, sha, api }) {
  const version = readPackageVersion(showFile(cwd, sha, PACKAGE_JSON_PATH));
  const tag = `v${version}`;
  const skip = (reason) => ({ shouldTag: false, blocked: false, version, tag, reason, notes: '' });

  if (await api.tagExists(tag)) {
    return skip(`${tag} is already tagged (version unchanged since that release)`);
  }
  const latestTag = latestReleaseTag(cwd, sha);
  if (!latestTag) return skip('no vX.Y.Z release tag is reachable from this commit');
  const latest = latestTag.slice(1);
  if (compareVersions(version, latest) <= 0) {
    return skip(`package.json ${version} is not newer than the latest release ${latest}`);
  }
  const top = parseTopReleaseVersion(showFile(cwd, sha, METAINFO_PATH));
  if (top !== version) {
    return skip(
      `Flatpak MetaInfo top release ${top ?? 'missing'} does not match package.json ${version}`,
    );
  }

  const pulls = (await api.pullsForCommit(sha)) ?? [];
  const merged = pulls.find((pull) => pull.merge_commit_sha === sha);
  const gates = await gatesOnTree({ sha, head: merged?.head?.sha, api });
  if (!gates.ok) {
    return {
      shouldTag: false,
      blocked: true,
      version,
      tag,
      reason: `${tag} is new, but the release gates have not passed on this commit's tree: ${gates.notPassed.join(', ')}`,
      notes: '',
    };
  }
  // Only the release pull request's notes describe this release. When the tag lands on a later
  // commit (E2E run on main after a miss), that commit's pull request is an ordinary one.
  const releasePull = merged?.title?.trim() === releaseTitle(version) ? merged : undefined;
  const fromPull = releasePull
    ? extractSection(releasePull.body ?? '', RELEASE_NOTES_HEADING)
    : null;
  const notes =
    fromPull || buildReleaseNotes(commitsInRange(cwd, `${latestTag}..${sha}`, { noMerges: true }));
  return {
    shouldTag: true,
    blocked: false,
    version,
    tag,
    reason: `${tag} is new (latest release ${latestTag})`,
    notes,
  };
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { sha: '', notesFile: '', requireTag: false, repo: undefined };
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--sha') options.sha = args[++index] ?? '';
    else if (arg === '--notes-file') options.notesFile = args[++index] ?? '';
    else if (arg === '--repo') options.repo = args[++index];
    else if (arg === '--require-tag') options.requireTag = true;
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}`);
  }
  if (!SHA_PATTERN.test(options.sha)) throw new Error('--sha <40-character commit id> is required');
  return options;
}

/**
 * @param {{ argv: string[], env?: Record<string, string | undefined>, cwd?: string, api?: object }} options
 * @returns {Promise<number>} exit code
 */
export async function runCli({ argv, env = process.env, cwd = process.cwd(), api }) {
  const args = parseArgs(argv);
  const client =
    api ??
    createGithubApi({
      token: resolveToken({ env }),
      repo: resolveRepo({ env, argRepo: args.repo, cwd }),
    });
  const plan = await planReleaseTag({ cwd, sha: args.sha, api: client });

  if (env.GITHUB_OUTPUT) {
    let output = `should_tag=${plan.shouldTag}\nversion=${plan.version}\ntag=${plan.tag}\n`;
    if (plan.shouldTag) {
      // Multi-line output: a random delimiter cannot appear in the notes by accident.
      const delimiter = `RELEASE_NOTES_${randomBytes(16).toString('hex')}`;
      output += `notes<<${delimiter}\n${plan.notes}\n${delimiter}\n`;
    }
    appendFileSync(env.GITHUB_OUTPUT, output);
  }
  let decision = `No tag: ${plan.reason}`;
  if (plan.shouldTag) decision = `Tag ${plan.tag}: ${plan.reason}`;
  else if (plan.blocked) decision = `Blocked: ${plan.reason}`;
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      [
        '### Cut release',
        '',
        '| Commit | Version | Decision |',
        '| --- | --- | --- |',
        `| \`${args.sha.slice(0, 7)}\` | ${plan.version} | ${decision} |`,
        '',
      ].join('\n'),
    );
  }
  if (args.notesFile && plan.shouldTag) writeFileSync(args.notesFile, `${plan.notes}\n`);
  if (plan.blocked) {
    const annotation = env.GITHUB_ACTIONS === 'true' ? '::error::' : '';
    console.error(`${annotation}Not tagging ${plan.tag}: ${plan.reason}.`);
    console.error(
      "This happens when a gate failed, or when something else reached main after the release pull request's checks ran.",
    );
    console.error(
      'Run the E2E workflow on main (Actions, E2E, Run workflow). When it passes, run Cut release on main (Actions, Cut release, Run workflow) before anything else merges, so both runs see the same commit.',
    );
    return 1;
  }
  console.info(decision);
  if (args.requireTag && !plan.shouldTag) {
    console.error('Refusing to tag: the commit no longer qualifies for a release.');
    return 1;
  }
  return 0;
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  runCli({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
