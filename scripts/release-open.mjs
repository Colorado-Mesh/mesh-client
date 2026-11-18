#!/usr/bin/env node
/**
 * Open or refresh the release pull request on main.
 *
 *   pnpm run release:open [-- --bump auto|patch|minor|major|X.Y.Z] [--dry-run] [--draft] [--remote <name>]
 *
 * From the tip of `main`, count the next version from the commit titles since the latest
 * release (the latest tag, or a merged release whose tag still waits for approval), build the
 * one commit that bumps it (`chore: release vX.Y.Z`, package.json and the Flatpak MetaInfo),
 * push it as `release/vX.Y.Z` and open or update the pull request with generated release notes.
 * Nothing is pushed to `main`, and the checkout is never touched: the commit is built in a
 * temporary index.
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
  latestReleaseTag,
  revParse,
  showFile,
  treeOf,
  treeWithFiles,
} from './releaseGit.mjs';
import {
  buildReleaseBody,
  buildReleaseNotes,
  isBookkeepingSubject,
  releaseTitle,
  riskCallouts,
} from './releaseNotes.mjs';
import {
  METAINFO_PATH,
  PACKAGE_JSON_PATH,
  parseSchemaVersion,
  readPackageVersion,
  releaseBaseline,
  resolveNextVersion,
  SCHEMA_SOURCE_PATH,
  setPackageVersion,
  upsertMetainfoRelease,
} from './releaseVersion.mjs';

const USAGE =
  'Usage: pnpm run release:open [-- --bump auto|patch|minor|major|X.Y.Z] [--dry-run] [--draft] [--remote <name>]';
const BUMP_VALUE = /^(auto|patch|minor|major|\d+\.\d+\.\d+)$/;
const RELEASE_TITLE_PREFIX = 'chore: release v';

/**
 * @param {string[]} argv
 * @returns {{ bump: string, dryRun: boolean, draft: boolean, remote: string }}
 */
export function parseArgs(argv) {
  const options = { bump: 'auto', dryRun: false, draft: false, remote: 'origin' };
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inline] = arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => (inline !== undefined ? inline : args[++index]);
    if (flag === '--bump') options.bump = value();
    else if (flag === '--remote') options.remote = value();
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--draft') options.draft = true;
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
 * @param {string[]} names
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
 * Paths changed by the commits a release ships. Release commits are left out, so a version bump
 * raises no risk callout.
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
 * Where the next release counts from. Normally the latest tag; while a merged release waits for
 * its tag, the commit that set main's version, so that release's own changes are not counted
 * again.
 * @param {string} cwd
 * @param {string} mainSha
 * @returns {{ since: string, latestVersion: string }}
 */
function releaseStart(cwd, mainSha) {
  const latestTag = latestReleaseTag(cwd, mainSha);
  if (!latestTag) throw new Error('No vX.Y.Z release tag is reachable from main');
  const mainVersion = readPackageVersion(showFile(cwd, mainSha, PACKAGE_JSON_PATH));
  const baseline = releaseBaseline({ tagVersion: latestTag.slice(1), mainVersion });
  if (!baseline.waiting) return { since: latestTag, latestVersion: baseline.version };
  const needle = `"version": "${mainVersion}"`;
  const since = git(cwd, [
    'log',
    '-1',
    '--format=%H',
    `-S${needle}`,
    `${latestTag}..${mainSha}`,
    '--',
    PACKAGE_JSON_PATH,
  ]);
  if (!since) {
    throw new Error(
      `main's package.json is at ${mainVersion}, ahead of ${latestTag}, but no commit since ${latestTag} sets that version`,
    );
  }
  return { since, latestVersion: baseline.version };
}

/**
 * The release commit on the remote branch when it is already exactly the one this run would
 * build (same parent, tree and title), so a refresh does not restart the checks for nothing.
 * @param {{ cwd: string, remote: string, branch: string, sha: string, mainSha: string, tree: string, title: string }} input
 * @returns {string | null}
 */
function currentReleaseCommit({ cwd, remote, branch, sha, mainSha, tree, title }) {
  if (!sha) return null;
  fetchRefs(cwd, remote, [`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  const parents = git(cwd, ['rev-list', '--parents', '-n', '1', sha]).split(' ').slice(1);
  const subject = git(cwd, ['log', '-1', '--format=%s', sha]);
  return parents.length === 1 &&
    parents[0] === mainSha &&
    treeOf(cwd, sha) === tree &&
    subject === title
    ? sha
    : null;
}

/**
 * Open release pull requests to main from this repository, newest first. Only `release/`
 * branches count, the ones this command creates: it force-pushes to the one it refreshes, so a
 * release-titled pull request from anyone's other branch or fork is never touched.
 * @param {(args: string[], input?: string) => string} gh
 * @returns {{ number: number, url: string, headRefName: string }[]}
 */
function openReleasePulls(gh) {
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
  return listed
    .filter(
      (pr) =>
        !pr.isCrossRepository &&
        pr.headRefName.startsWith('release/') &&
        pr.title.trim().startsWith(RELEASE_TITLE_PREFIX),
    )
    .sort((a, b) => b.number - a.number);
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
export async function openRelease({ cwd, remote, bump, dryRun, draft, today, gh }) {
  fetchRefs(cwd, remote, [
    `+refs/heads/main:refs/remotes/${remote}/main`,
    '+refs/tags/v*:refs/tags/v*',
  ]);
  const mainSha = revParse(cwd, `refs/remotes/${remote}/main`);
  const { since, latestVersion } = releaseStart(cwd, mainSha);
  const range = `${since}..${mainSha}`;
  const shipped = commitsInRange(cwd, range, { noMerges: true }).filter(
    (commit) => !isBookkeepingSubject(commit.subject),
  );
  if (shipped.length === 0) return { status: 'nothing-to-release', version: latestVersion };

  const detected = detectReleaseBump(
    shipped.map((commit) => commit.subject),
    shipped.map((commit) => commit.body).join('\n'),
  );
  const version = resolveNextVersion({ latestVersion, bump, detected });
  const title = releaseTitle(version);
  const tree = treeWithFiles(cwd, mainSha, {
    [PACKAGE_JSON_PATH]: setPackageVersion(showFile(cwd, mainSha, PACKAGE_JSON_PATH), version),
    [METAINFO_PATH]: upsertMetainfoRelease(showFile(cwd, mainSha, METAINFO_PATH), {
      version,
      date: today,
      latestVersion,
    }),
  });
  const body = buildReleaseBody({
    notes: buildReleaseNotes(shipped),
    fromVersion: latestVersion,
    toVersion: version,
    bumpReason: bumpReason(bump, detected),
    schemaFrom: parseSchemaVersion(showFile(cwd, since, SCHEMA_SOURCE_PATH)),
    schemaTo: parseSchemaVersion(showFile(cwd, mainSha, SCHEMA_SOURCE_PATH)),
    risks: riskCallouts(shippedPaths(cwd, range)),
    mainSha,
    since: `v${latestVersion}`,
  });

  // Refresh the release pull request that is already open, on its own branch, even when the
  // version (and so the branch name this run would pick) changed; a second one would stay open.
  const pulls = openReleasePulls(gh);
  const branch = `release/v${version}`;
  const current = pulls.find((pr) => pr.headRefName === branch) ?? pulls[0] ?? null;
  const target = current ? current.headRefName : branch;
  const remoteSha = remoteBranches(cwd, remote, [target])[target] ?? '';
  const existing = currentReleaseCommit({
    cwd,
    remote,
    branch: target,
    sha: remoteSha,
    mainSha,
    tree,
    title,
  });
  const push = existing === null;
  if (dryRun) {
    return {
      status: 'dry-run',
      version,
      branch: target,
      pr: current ? current.number : null,
      push,
      title,
      body,
    };
  }

  if (push) {
    const releaseSha = commitTree(cwd, { tree, parents: [mainSha], message: `${title}\n` });
    pushBranch(cwd, remote, target, releaseSha, remoteSha);
  }
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
  const superseded = pulls.filter((pr) => pr !== current);
  for (const pr of superseded) {
    gh([
      'pr',
      'close',
      String(pr.number),
      '--comment',
      `Superseded by ${url}, which releases the current main.`,
    ]);
  }
  return {
    status,
    version,
    branch: target,
    pushed: push,
    title,
    body,
    url,
    superseded: superseded.map((pr) => pr.number),
  };
}

/**
 * @param {{ branch: string, title: string, pr: number | null, push: boolean }} result
 * @returns {string}
 */
export function dryRunLine({ branch, title, pr, push }) {
  const action = pr ? `update #${pr} to "${title}"` : `open "${title}"`;
  return push
    ? `Dry run: would push ${branch} and ${action}.`
    : `Dry run: ${branch} is current; would ${action}.`;
}

/**
 * What to do after a release pull request was opened or updated.
 * @param {{
 *   status: 'opened' | 'updated',
 *   version: string,
 *   url: string,
 *   branch: string,
 *   pushed: boolean,
 *   superseded?: number[],
 * }} result
 * @returns {string[]}
 */
export function nextSteps(result) {
  const lines = [`${result.status === 'opened' ? 'Opened' : 'Updated'} ${result.url}`];
  if (!result.pushed) {
    lines.push(
      `${result.branch} already held this release commit, so nothing was pushed and its checks keep their results.`,
    );
  }
  if (result.superseded?.length) {
    const numbers = result.superseded.map((number) => `#${number}`).join(' and ');
    lines.push(`Closed ${numbers} as superseded by this one.`);
  }
  lines.push(
    'Next: wait for the Release gates check (Electron E2E on Linux, macOS and Windows, and the release preflight) on that pull request, get a review, and add it to the merge queue.',
    `Merging starts Cut release: approve its Tag release job (release-cut environment) to tag v${result.version}, then check the draft release once its artifacts are attached and publish it.`,
  );
  return lines;
}

const GITHUB_HOSTS = new Set(['github.com', 'ssh.github.com']);
const SSH_PROTOCOLS = new Set(['ssh:', 'git+ssh:', 'ssh+git:']);
const URL_PROTOCOLS = new Set(['https:', 'http:', 'git:', ...SSH_PROTOCOLS]);
const REPO_NAME = /^[A-Za-z0-9_.-]+$/;
const SSH_HOST = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/**
 * The real hostname ssh uses for `host`, from `ssh -G` (which only prints the configuration), so a
 * host alias in ~/.ssh/config resolves the way gh resolves it.
 * @param {string} host
 * @param {typeof execFileSync} [runFile] runs a program with an argument array, never a shell
 * @returns {string | null}
 */
export function sshHostname(host, runFile = execFileSync) {
  if (!SSH_HOST.test(host)) return null;
  try {
    const config = String(
      runFile('ssh', ['-G', host], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    );
    const line = config.split('\n').find((entry) => entry.startsWith('hostname '));
    return line ? line.slice('hostname '.length).trim().toLowerCase() : null;
  } catch {
    // catch-no-log-ok ssh is missing or rejects the host; the caller then refuses the remote.
    return null;
  }
}

/** @param {string} path @returns {string | null} `owner/repo` */
function ownerRepoFromPath(path) {
  let trimmed = path.replace(/^[/]+/, '').replace(/[/]+$/, '');
  if (trimmed.endsWith('.git')) trimmed = trimmed.slice(0, -'.git'.length);
  const parts = trimmed.split('/');
  const valid = parts.every((part) => REPO_NAME.test(part) && part !== '.' && part !== '..');
  return parts.length === 2 && valid ? `${parts[0]}/${parts[1]}` : null;
}

/**
 * The `owner/repo` of a remote URL on github.com, or null for any other host, a local path or a
 * URL that names no single repository. An ssh host other than github.com counts when
 * `resolveSshHost` maps it there (an alias in ~/.ssh/config).
 * @param {string} url
 * @param {(host: string) => string | null} [resolveSshHost]
 * @returns {string | null}
 */
export function githubRepoFromRemoteUrl(url, resolveSshHost = sshHostname) {
  const value = url.trim();
  let host;
  let path;
  let ssh;
  if (value.includes('://')) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      // catch-no-log-ok not a URL; the caller refuses the remote.
      return null;
    }
    if (!URL_PROTOCOLS.has(parsed.protocol)) return null;
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname;
    ssh = SSH_PROTOCOLS.has(parsed.protocol);
  } else {
    // scp-like [user@]host:path; git reads a value with a slash before the first colon as a path.
    const colon = value.indexOf(':');
    const slash = value.indexOf('/');
    if (colon <= 0 || (slash !== -1 && slash < colon)) return null;
    const userHost = value.slice(0, colon);
    host = userHost.slice(userHost.lastIndexOf('@') + 1).toLowerCase();
    path = value.slice(colon + 1);
    ssh = true;
  }
  const repo = ownerRepoFromPath(path);
  // A one-letter host is a Windows drive letter, never a server.
  if (!repo || host.length < 2) return null;
  if (GITHUB_HOSTS.has(host)) return repo;
  if (!ssh) return null;
  const resolved = resolveSshHost(host);
  return resolved && GITHUB_HOSTS.has(resolved) ? repo : null;
}

/**
 * The github.com repository `remote` pushes to, read before anything is fetched or pushed, so the
 * pull request goes where the branch goes whatever gh's default repository is. Refusals name the
 * remote and never its URL, which can carry a token.
 * @param {string} cwd
 * @param {string} remote
 * @param {(host: string) => string | null} [resolveSshHost]
 * @returns {string} `owner/repo`
 */
export function remoteRepository(cwd, remote, resolveSshHost = sshHostname) {
  const fetchRepo = githubRepoFromRemoteUrl(
    git(cwd, ['remote', 'get-url', remote]),
    resolveSshHost,
  );
  const pushRepo = githubRepoFromRemoteUrl(
    git(cwd, ['remote', 'get-url', '--push', remote]),
    resolveSshHost,
  );
  if (!fetchRepo || !pushRepo) {
    throw new Error(
      `Remote ${remote} is not a github.com repository. release:open opens the release pull request in the repository it pushes to; pass --remote with a remote on github.com.`,
    );
  }
  if (fetchRepo !== pushRepo) {
    throw new Error(
      `Remote ${remote} fetches from ${fetchRepo} but pushes to ${pushRepo}; release:open needs one repository.`,
    );
  }
  return pushRepo;
}

/**
 * Runs gh for one repository: every call gets `--repo`, so pull request operations never follow
 * gh's own default repository.
 * @param {string} cwd
 * @param {string} repo `owner/repo`
 * @param {typeof execFileSync} [runFile] runs a program with an argument array, never a shell
 * @returns {(args: string[], input?: string) => string}
 */
export function ghRunner(cwd, repo, runFile = execFileSync) {
  return (args, input) =>
    String(
      runFile('gh', [...args, '--repo', repo], {
        cwd,
        encoding: 'utf8',
        input,
        stdio: ['pipe', 'pipe', 'inherit'],
      }),
    );
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
  const repo = remoteRepository(cwd, options.remote);
  console.info(`Repository: ${repo} (remote ${options.remote})`);
  const result = await openRelease({
    cwd,
    remote: options.remote,
    bump: options.bump,
    dryRun: options.dryRun,
    draft: options.draft,
    today: new Date().toISOString().slice(0, 10),
    gh: ghRunner(cwd, repo),
  });
  if (result.status === 'nothing-to-release') {
    console.info(`main has nothing new since v${result.version}; there is nothing to release.`);
  } else if (result.status === 'dry-run') {
    console.info(`${dryRunLine(result)}\n`);
    console.info(result.body);
  } else {
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
