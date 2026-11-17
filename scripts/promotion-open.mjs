#!/usr/bin/env node
/**
 * Open or refresh the promotion pull request that releases `staging` to `main`.
 *
 *   pnpm run promotion:open [-- --bump auto|patch|minor|major|none|X.Y.Z] [--dry-run] [--draft]
 *   pnpm run promotion:backport [-- --dry-run]
 *
 * Steps: back-port anything `main` has that `staging` lacks (a real merge commit), commit the
 * version bump to `staging` (`chore: release vX.Y.Z`), build the promotion commit (parents
 * `main` and `staging`, tree exactly `staging`'s), push `release/vX.Y.Z`, and open or update
 * the pull request with generated release notes. Pushing to `staging` needs admin rights,
 * like `pnpm run release` pushing to `main` used to. The checkout is never touched.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { detectReleaseBump } from './detectReleaseBump.mjs';
import {
  commitPathsInRange,
  commitsInRange,
  commitTree,
  fetchRefs,
  git,
  isAncestor,
  latestReleaseTag,
  mergeText,
  mergeTree,
  revParse,
  showFile,
  treeOf,
  treeWithFiles,
} from './promotionGit.mjs';
import {
  BACKPORT_SUBJECT,
  buildPromotionBody,
  buildReleaseNotes,
  isBookkeepingSubject,
  PROMOTION_TITLE_PREFIX,
  promotionTitle,
  riskCallouts,
} from './promotionNotes.mjs';
import {
  compareVersions,
  METAINFO_PATH,
  metainfoReleaseVersions,
  PACKAGE_JSON_PATH,
  parseSchemaVersion,
  readPackageVersion,
  releaseBaseline,
  resolveNextVersion,
  restoreMetainfoRelease,
  SCHEMA_SOURCE_PATH,
  setPackageVersion,
  takeTopMetainfoRelease,
  upsertMetainfoRelease,
} from './releaseVersion.mjs';

const USAGE =
  'Usage: pnpm run promotion:open [-- --bump auto|patch|minor|major|none|X.Y.Z] [--dry-run] [--draft] [--remote <name>]\n' +
  '       pnpm run promotion:backport [-- --dry-run] [--remote <name>]';
const BUMP_VALUE = /^(auto|patch|minor|major|none|\d+\.\d+\.\d+)$/;

/**
 * @param {string[]} argv
 * @returns {{ bump: string, dryRun: boolean, draft: boolean, backportOnly: boolean, remote: string }}
 */
export function parseArgs(argv) {
  const options = {
    bump: 'auto',
    dryRun: false,
    draft: false,
    backportOnly: false,
    remote: 'origin',
  };
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inline] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => (inline !== undefined ? inline : args[++index]);
    if (flag === '--bump') options.bump = value();
    else if (flag === '--remote') options.remote = value();
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--draft') options.draft = true;
    else if (arg === '--backport-only') options.backportOnly = true;
    else throw new Error(`Unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
  }
  if (!BUMP_VALUE.test(options.bump ?? '')) {
    throw new Error(`Unknown bump ${JSON.stringify(options.bump)}\n${USAGE}`);
  }
  if (!options.remote) throw new Error(`Missing remote name\n${USAGE}`);
  return options;
}

/**
 * @param {string} cwd
 * @param {string} remote
 * @returns {Record<string, string>} remote branch name to commit id
 */
function remoteBranches(cwd, remote, names) {
  const output = git(cwd, [
    'ls-remote',
    '--heads',
    remote,
    ...names.map((name) => `refs/heads/${name}`),
  ]);
  /** @type {Record<string, string>} */
  const branches = {};
  for (const line of output.split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    branches[ref.replace('refs/heads/', '')] = sha;
  }
  return branches;
}

/** @param {string} cwd @param {string} remote */
function fetchMainAndStaging(cwd, remote) {
  fetchRefs(cwd, remote, [
    `+refs/heads/main:refs/remotes/${remote}/main`,
    `+refs/heads/staging:refs/remotes/${remote}/staging`,
    '+refs/tags/v*:refs/tags/v*',
  ]);
  return {
    mainSha: revParse(cwd, `refs/remotes/${remote}/main`),
    stagingSha: revParse(cwd, `refs/remotes/${remote}/staging`),
  };
}

/**
 * @param {string} cwd
 * @param {string} remote
 * @param {string} branch
 * @param {string} sha
 * @param {string} expected - current remote value, or '' when the branch must not exist yet
 */
function pushBranch(cwd, remote, branch, sha, expected) {
  git(cwd, [
    'push',
    '--quiet',
    `--force-with-lease=refs/heads/${branch}:${expected}`,
    remote,
    `${sha}:refs/heads/${branch}`,
  ]);
}

const VERSION_FILES = new Set([PACKAGE_JSON_PATH, METAINFO_PATH]);

/**
 * package.json when both sides moved the version: merge the rest of the file, then keep the
 * higher version.
 * @param {string} cwd
 * @param {{ base: string, ours: string, theirs: string }} texts
 * @returns {string | null} null when other lines conflict too
 */
function resolvePackageJson(cwd, { base, ours, theirs }) {
  const baseVersion = readPackageVersion(base);
  const oursVersion = readPackageVersion(ours);
  const theirsVersion = readPackageVersion(theirs);
  const merged = mergeText(cwd, {
    ours: setPackageVersion(ours, baseVersion),
    base,
    theirs: setPackageVersion(theirs, baseVersion),
  });
  if (!merged.clean) return null;
  const version = compareVersions(oursVersion, theirsVersion) >= 0 ? oursVersion : theirsVersion;
  return setPackageVersion(merged.text, version);
}

/**
 * MetaInfo when staging's unreleased entry and main's released one both went on top: merge
 * without staging's entry, so main's released entries stay, then put staging's entry back on top
 * if it is still the newest.
 * @param {string} cwd
 * @param {{ base: string, ours: string, theirs: string }} texts
 * @returns {string | null} null when other lines conflict too
 */
function resolveMetainfo(cwd, { base, ours, theirs }) {
  const known = new Set(metainfoReleaseVersions(base));
  const top = takeTopMetainfoRelease(ours);
  const unreleased = top && !known.has(top.version) ? top : null;
  const merged = mergeText(cwd, { ours: unreleased ? unreleased.xml : ours, base, theirs });
  if (!merged.clean) return null;
  return unreleased ? restoreMetainfoRelease(merged.text, unreleased) : merged.text;
}

/**
 * A back-port meets conflicts in the version files when `main` released a hotfix while `staging`
 * carries an unreleased version bump. Resolve exactly those; anything else stays a conflict.
 * @param {string} cwd
 * @param {{ stagingSha: string, mainSha: string, conflicts: string[] }} merge
 * @returns {Record<string, string> | null} resolved contents by path, or null to stop
 */
function resolveVersionFiles(cwd, { stagingSha, mainSha, conflicts }) {
  if (!conflicts.every((file) => VERSION_FILES.has(file))) return null;
  const base = git(cwd, ['merge-base', stagingSha, mainSha]);
  const resolved = {};
  for (const file of conflicts) {
    const texts = {
      base: showFile(cwd, base, file),
      ours: showFile(cwd, stagingSha, file),
      theirs: showFile(cwd, mainSha, file),
    };
    const text =
      file === PACKAGE_JSON_PATH ? resolvePackageJson(cwd, texts) : resolveMetainfo(cwd, texts);
    if (text === null) return null;
    resolved[file] = text;
  }
  return resolved;
}

/**
 * Plan the back-port of `main` into `staging` without pushing.
 * @returns {{ status: 'not-needed' } | { status: 'conflict', conflicts: string[] } | { status: 'merged', sha: string, resolved?: string[] }}
 */
function planBackport(cwd, mainSha, stagingSha) {
  if (isAncestor(cwd, mainSha, stagingSha)) return { status: 'not-needed' };
  const merged = mergeTree(cwd, stagingSha, mainSha);
  let tree = merged.tree;
  let resolved = [];
  if (!merged.clean) {
    const files = resolveVersionFiles(cwd, {
      stagingSha,
      mainSha,
      conflicts: merged.conflicts,
    });
    if (!files) return { status: 'conflict', conflicts: merged.conflicts };
    tree = treeWithFiles(cwd, merged.tree, files);
    resolved = Object.keys(files);
  }
  if (tree === treeOf(cwd, stagingSha)) return { status: 'not-needed' };
  const sha = commitTree(cwd, {
    tree,
    parents: [stagingSha, mainSha],
    message: `${BACKPORT_SUBJECT}\n`,
  });
  return resolved.length > 0 ? { status: 'merged', sha, resolved } : { status: 'merged', sha };
}

/**
 * Merge `main` into `staging` as a real merge commit when `main` has content `staging` lacks.
 * @param {{ cwd: string, remote: string, dryRun: boolean }} options
 */
export function backportMainIntoStaging({ cwd, remote, dryRun }) {
  const { mainSha, stagingSha } = fetchMainAndStaging(cwd, remote);
  const plan = planBackport(cwd, mainSha, stagingSha);
  if (plan.status === 'merged' && !dryRun) pushBranch(cwd, remote, 'staging', plan.sha, stagingSha);
  return plan;
}

/**
 * @param {string} bump
 * @param {string} detected
 */
function bumpReason(bump, detected) {
  if (bump === 'auto') return `${detected}, detected from commit titles`;
  if (['patch', 'minor', 'major'].includes(bump)) return `${bump}, chosen with --bump`;
  return 'set with --bump';
}

/**
 * Paths changed by the commits a promotion ships. The tooling's own release bump and back-port
 * commits are left out, so the bump's package.json and MetaInfo edits raise no risk callout.
 * @param {string} cwd
 * @param {string} range
 * @returns {string[]}
 */
function shippedPaths(cwd, range) {
  const paths = new Set();
  for (const commit of commitPathsInRange(cwd, range)) {
    if (isBookkeepingSubject(commit.subject)) continue;
    for (const file of commit.paths) paths.add(file);
  }
  return [...paths].sort();
}

/**
 * @param {{
 *   cwd: string,
 *   remote: string,
 *   bump: string,
 *   dryRun: boolean,
 *   draft: boolean,
 *   today: string,
 *   gh: (args: string[], input?: string) => string,
 * }} options
 */
export async function openPromotion({ cwd, remote, bump, dryRun, draft, today, gh }) {
  const existing = remoteBranches(cwd, remote, ['main', 'staging']);
  if (!existing.staging) return { status: 'no-staging', version: null };
  if (!existing.main) throw new Error(`${remote} has no main branch`);

  const { mainSha, stagingSha } = fetchMainAndStaging(cwd, remote);
  if (isAncestor(cwd, stagingSha, mainSha)) return { status: 'nothing-to-promote', version: null };

  const backport = planBackport(cwd, mainSha, stagingSha);
  if (backport.status === 'conflict') {
    return { status: 'conflict', version: null, conflicts: backport.conflicts };
  }
  let stagingTip = backport.status === 'merged' ? backport.sha : stagingSha;

  const latestTag = latestReleaseTag(cwd, mainSha);
  if (!latestTag) throw new Error('No vX.Y.Z release tag is reachable from main');
  // While main's last release waits for its tag, count from main's version and ship only what
  // main does not have yet; that release's own changes are already on their way.
  const baseline = releaseBaseline({
    tagVersion: latestTag.slice(1),
    mainVersion: readPackageVersion(showFile(cwd, mainSha, PACKAGE_JSON_PATH)),
  });
  const latestVersion = baseline.version;
  const since = baseline.waiting ? mainSha : latestTag;
  const shipped = commitsInRange(cwd, `${since}..${stagingTip}`, { noMerges: true }).filter(
    (commit) => !isBookkeepingSubject(commit.subject),
  );
  const detected = detectReleaseBump(
    shipped.map((commit) => commit.subject),
    shipped.map((commit) => commit.body).join('\n'),
  );
  const release = bump !== 'none';
  const version = resolveNextVersion({ latestVersion, bump, detected });

  const packageText = showFile(cwd, stagingTip, PACKAGE_JSON_PATH);
  const stagingVersion = readPackageVersion(packageText);
  if (!release && stagingVersion !== latestVersion) {
    throw new Error(
      `staging already carries unreleased version ${stagingVersion}; promote it with a release or revert the bump`,
    );
  }
  if (release && stagingVersion !== version) {
    const tree = treeWithFiles(cwd, stagingTip, {
      [PACKAGE_JSON_PATH]: setPackageVersion(packageText, version),
      [METAINFO_PATH]: upsertMetainfoRelease(showFile(cwd, stagingTip, METAINFO_PATH), {
        version,
        date: today,
        latestVersion,
      }),
    });
    stagingTip = commitTree(cwd, {
      tree,
      parents: [stagingTip],
      message: `chore: release v${version}\n`,
    });
  }

  const title = promotionTitle(release ? version : null);
  const promotionSha = commitTree(cwd, {
    tree: treeOf(cwd, stagingTip),
    parents: [mainSha, stagingTip],
    message: `${title}\n`,
  });
  const branch = release ? `release/v${version}` : `release/promote-staging-${today}`;
  const body = buildPromotionBody({
    notes: buildReleaseNotes(commitsInRange(cwd, `${since}..${stagingTip}`, { noMerges: true })),
    fromVersion: latestVersion,
    toVersion: release ? version : latestVersion,
    bumpReason: bumpReason(bump, detected),
    schemaMain: parseSchemaVersion(showFile(cwd, mainSha, SCHEMA_SOURCE_PATH)),
    schemaHead: parseSchemaVersion(showFile(cwd, stagingTip, SCHEMA_SOURCE_PATH)),
    risks: riskCallouts(shippedPaths(cwd, `${mainSha}..${stagingTip}`)),
    mainSha,
    stagingSha: stagingTip,
  });
  const resultVersion = release ? version : null;
  // Refresh the promotion that is already open, on its own branch, even when the version (and so
  // the branch name this run would pick) changed; a second promotion would stay open beside it.
  const promotions = openPromotions(gh);
  const current = promotions.find((pr) => pr.headRefName === branch) ?? promotions[0] ?? null;
  const target = current ? current.headRefName : branch;
  if (dryRun) {
    return {
      status: 'dry-run',
      version: resultVersion,
      branch: target,
      pr: current ? current.number : null,
      title,
      body,
      backport: backport.status,
    };
  }

  if (stagingTip !== stagingSha) pushBranch(cwd, remote, 'staging', stagingTip, stagingSha);
  const currentBranch = remoteBranches(cwd, remote, [target])[target] ?? '';
  pushBranch(cwd, remote, target, promotionSha, currentBranch);

  let status;
  let url;
  if (current) {
    gh(['pr', 'edit', String(current.number), '--title', title, '--body-file', '-'], body);
    status = 'updated';
    url = current.url;
  } else {
    const createArgs = [
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      target,
      '--title',
      title,
      '--body-file',
      '-',
    ];
    if (draft) createArgs.push('--draft');
    status = 'opened';
    url = gh(createArgs, body).trim();
  }
  const superseded = promotions.filter((pr) => pr !== current);
  for (const pr of superseded) {
    gh([
      'pr',
      'close',
      String(pr.number),
      '--comment',
      `Superseded by ${url}, which promotes the current staging.`,
    ]);
  }
  return {
    status,
    version: resultVersion,
    branch: target,
    title,
    body,
    url,
    superseded: superseded.map((pr) => pr.number),
  };
}

/**
 * Open promotion pull requests to main from this repository, newest first. Only `release/`
 * branches count, the ones this command creates: it force-pushes to the one it refreshes, so a
 * promotion-titled pull request from anyone's other branch is never touched.
 * @param {(args: string[], input?: string) => string} gh
 * @returns {{ number: number, url: string, headRefName: string }[]}
 */
function openPromotions(gh) {
  const listed = JSON.parse(
    gh([
      'pr',
      'list',
      '--base',
      'main',
      '--state',
      'open',
      '--json',
      'number,url,headRefName,title,isCrossRepository',
    ]),
  );
  const prefix = PROMOTION_TITLE_PREFIX.toLowerCase();
  return listed
    .filter(
      (pr) =>
        !pr.isCrossRepository &&
        pr.headRefName.startsWith('release/') &&
        pr.title.trim().toLowerCase().startsWith(prefix),
    )
    .sort((a, b) => b.number - a.number);
}

/**
 * @param {{ branch: string, title: string, pr: number | null }} result
 * @returns {string}
 */
export function dryRunLine({ branch, title, pr }) {
  return pr
    ? `Dry run: would push ${branch} and update #${pr} to "${title}".`
    : `Dry run: would push ${branch} and open "${title}".`;
}

/**
 * What to do after a promotion pull request was opened or updated. A release still needs the
 * maintainer's approval in Cut release before it is tagged; a promotion without a release tags
 * nothing.
 * @param {{ status: 'opened' | 'updated', version: string | null, url: string, superseded?: number[] }} result
 * @returns {string[]}
 */
export function nextSteps(result) {
  const lines = [`${result.status === 'opened' ? 'Opened' : 'Updated'} ${result.url}`];
  if (result.superseded?.length) {
    const numbers = result.superseded.map((number) => `#${number}`).join(' and ');
    lines.push(`Closed ${numbers} as superseded by this one.`);
  }
  lines.push(
    'Next: wait for the Promotion Doctor and CI on that pull request, get a review, and merge it with a merge commit.',
    result.version
      ? `Merging starts Cut release: approve its Tag release job (release-cut environment) to tag v${result.version}, then check the draft release once its artifacts are attached and publish it.`
      : 'This promotion keeps the current version, so merging it tags no release.',
  );
  return lines;
}

/**
 * What promotion:backport did.
 * @param {{ status: string, sha?: string, resolved?: string[] }} result
 * @param {{ dryRun: boolean }} options
 * @returns {string[]}
 */
export function backportLines(result, { dryRun }) {
  if (result.status !== 'merged' || !result.sha) {
    return ['staging already has everything main has; nothing to back-port.'];
  }
  const lines = [
    `${dryRun ? 'Would push' : 'Pushed'} back-port merge ${result.sha.slice(0, 7)} to staging.`,
  ];
  if (result.resolved?.length) {
    lines.push(
      `Resolved ${result.resolved.join(' and ')}: the higher version wins, and main's released MetaInfo entries stay below staging's unreleased one.`,
    );
  }
  return lines;
}

function ghRunner(cwd) {
  return (args, input) =>
    execFileSync('gh', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const cwd = process.cwd();
  if (options.backportOnly) {
    const result = backportMainIntoStaging({ cwd, remote: options.remote, dryRun: options.dryRun });
    if (result.status === 'conflict') {
      console.error(
        `main does not merge cleanly into staging. Conflicts: ${result.conflicts.join(', ')}`,
      );
      console.error(
        'Merge origin/main into a branch cut from staging, resolve, and push that merge commit to staging (an admin push; a pull request would be squashed).',
      );
      process.exit(1);
    }
    for (const line of backportLines(result, { dryRun: options.dryRun })) console.info(line);
    return;
  }

  const result = await openPromotion({
    cwd,
    remote: options.remote,
    bump: options.bump,
    dryRun: options.dryRun,
    draft: options.draft,
    today: new Date().toISOString().slice(0, 10),
    gh: ghRunner(cwd),
  });
  switch (result.status) {
    case 'no-staging':
      console.error(
        `${options.remote} has no staging branch yet, so there is nothing to promote. Switch the repository to the staging flow first (docs/ci-cd.md, Merge queue and rulesets).`,
      );
      process.exit(1);
      break;
    case 'nothing-to-promote':
      console.info('staging has nothing that main does not already have.');
      break;
    case 'conflict':
      console.error(
        `main does not merge cleanly into staging. Conflicts: ${result.conflicts.join(', ')}`,
      );
      console.error(
        'Run pnpm run promotion:backport for the manual route, then run promotion:open again.',
      );
      process.exit(1);
      break;
    case 'dry-run':
      console.info(`${dryRunLine(result)}\n`);
      console.info(result.body);
      break;
    default:
      for (const line of nextSteps(result)) console.info(line);
  }
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
