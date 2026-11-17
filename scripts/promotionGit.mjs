/**
 * Git plumbing for the staging promotion tooling. Every call passes an argv array (no shell),
 * and nothing here touches the working tree or the index: new trees are built in a temporary
 * index, so the caller's checkout can be dirty or on any branch.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
const RECORD_SEPARATOR = String.fromCharCode(0x1e);
/** Release tags look like v6.8.0; the glob keeps other v-prefixed tags out of describe. */
const RELEASE_TAG_GLOB = 'v[0-9]*.[0-9]*.[0-9]*';

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, input?: string }} [options]
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runGit(cwd, args, { env, input } = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: env ? { ...process.env, ...env } : process.env,
    input,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * @param {string[]} args
 * @param {{ status: number | null, stderr: string }} result
 */
function gitFailure(args, result) {
  return new Error(`git ${args[0]} exited ${result.status}: ${result.stderr.trim()}`);
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, input?: string }} [options]
 * @returns {string} stdout with surrounding whitespace removed
 */
export function git(cwd, args, options) {
  const result = runGit(cwd, args, options);
  if (result.status !== 0) throw gitFailure(args, result);
  return result.stdout.trim();
}

/** @param {string} cwd @param {string} rev @returns {string} */
export function revParse(cwd, rev) {
  return git(cwd, ['rev-parse', '--verify', `${rev}^{commit}`]);
}

/** @param {string} cwd @param {string} rev @returns {string} */
export function treeOf(cwd, rev) {
  return git(cwd, ['rev-parse', '--verify', `${rev}^{tree}`]);
}

/**
 * @param {string} cwd
 * @param {string} ancestor
 * @param {string} descendant
 * @returns {boolean}
 */
export function isAncestor(cwd, ancestor, descendant) {
  const args = ['merge-base', '--is-ancestor', ancestor, descendant];
  const result = runGit(cwd, args);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw gitFailure(args, result);
}

/**
 * Merge two commits without a checkout.
 * @param {string} cwd
 * @param {string} ours
 * @param {string} theirs
 * @returns {{ clean: boolean, tree: string, conflicts: string[] }}
 */
export function mergeTree(cwd, ours, theirs) {
  const args = ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs];
  const result = runGit(cwd, args);
  if (result.status !== 0 && result.status !== 1) throw gitFailure(args, result);
  const [tree, ...rest] = result.stdout.split('\n').filter(Boolean);
  return { clean: result.status === 0, tree, conflicts: [...new Set(rest)] };
}

/**
 * Three-way merge of one file's text, as `git merge-file` does, without touching the repository.
 * @param {string} cwd
 * @param {{ ours: string, base: string, theirs: string }} texts
 * @returns {{ clean: boolean, text: string }}
 */
export function mergeText(cwd, { ours, base, theirs }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-promotion-merge-'));
  try {
    const files = { ours, base, theirs };
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
    const args = [
      'merge-file',
      '-p',
      ...['ours', 'base', 'theirs'].map((name) => path.join(dir, name)),
    ];
    const result = runGit(cwd, args);
    if (result.status === null || result.status < 0 || result.status > 127) {
      throw gitFailure(args, result);
    }
    return { clean: result.status === 0, text: result.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build a tree from `baseRev` with some files replaced, in a temporary index.
 * @param {string} cwd
 * @param {string} baseRev
 * @param {Record<string, string>} files - repo-relative path to full file content
 * @returns {string} tree id
 */
export function treeWithFiles(cwd, baseRev, files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-promotion-index-'));
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    git(cwd, ['read-tree', baseRev], { env });
    for (const [file, content] of Object.entries(files)) {
      const blob = git(cwd, ['hash-object', '-w', '--stdin'], { input: content });
      const listed = git(cwd, ['ls-tree', baseRev, '--', file]);
      const mode = listed ? listed.split(/\s/)[0] : '100644';
      git(cwd, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${file}`], { env });
    }
    return git(cwd, ['write-tree'], { env });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string} cwd
 * @param {{ tree: string, parents: string[], message: string }} commit
 * @returns {string} commit id
 */
export function commitTree(cwd, { tree, parents, message }) {
  const args = ['commit-tree', tree];
  for (const parent of parents) args.push('-p', parent);
  args.push('-F', '-');
  return git(cwd, args, { input: message });
}

/**
 * @param {string} cwd
 * @param {string} rev
 * @param {string} file
 * @returns {string} exact file content
 */
export function showFile(cwd, rev, file) {
  const args = ['show', `${rev}:${file}`];
  const result = runGit(cwd, args);
  if (result.status !== 0) throw gitFailure(args, result);
  return result.stdout;
}

/**
 * @param {string} cwd
 * @param {string} rev
 * @returns {string | null} nearest vX.Y.Z tag reachable from `rev`
 */
export function latestReleaseTag(cwd, rev) {
  const args = ['describe', '--tags', '--abbrev=0', '--match', RELEASE_TAG_GLOB, rev];
  const result = runGit(cwd, args);
  if (result.status === 0) return result.stdout.trim();
  if (/No names found|No tags can describe|cannot describe/i.test(result.stderr)) return null;
  throw gitFailure(args, result);
}

/**
 * @param {string} cwd
 * @param {string} range - for example `v6.8.0..origin/staging`
 * @param {{ noMerges?: boolean }} [options]
 * @returns {Array<{ sha: string, subject: string, body: string }>}
 */
export function commitsInRange(cwd, range, { noMerges = false } = {}) {
  const args = ['log', '--format=%H%x1f%s%x1f%b%x1e'];
  if (noMerges) args.push('--no-merges');
  args.push(range, '--');
  const result = runGit(cwd, args);
  if (result.status !== 0) throw gitFailure(args, result);
  return result.stdout
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body = ''] = record.split(UNIT_SEPARATOR);
      return { sha, subject, body: body.trimEnd() };
    });
}

/**
 * @param {string} cwd
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
export function changedPaths(cwd, from, to) {
  return git(cwd, ['diff', '--name-only', from, to]).split('\n').filter(Boolean);
}

/**
 * The paths each non-merge commit in a range changes, with its subject, so a caller can leave
 * out commits the tooling made (a release bump) when judging what the range ships.
 * @param {string} cwd
 * @param {string} range - for example `origin/main..origin/staging`
 * @returns {Array<{ subject: string, paths: string[] }>}
 */
export function commitPathsInRange(cwd, range) {
  const args = ['log', '--no-merges', '--format=%x1e%s', '--name-only', range, '--'];
  const result = runGit(cwd, args);
  if (result.status !== 0) throw gitFailure(args, result);
  return result.stdout
    .split(RECORD_SEPARATOR)
    .filter(Boolean)
    .map((record) => {
      const [subject, ...files] = record.split('\n');
      return { subject, paths: files.filter(Boolean) };
    });
}

/**
 * Git config through the environment, so a token never appears in a process argument list.
 * @param {string | undefined} token
 * @returns {Record<string, string>}
 */
export function authEnv(token) {
  if (!token) return {};
  const credentials = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${credentials}`,
  };
}

/**
 * @param {string} cwd
 * @param {string} remote
 * @param {string[]} refspecs
 * @param {{ token?: string }} [options]
 */
export function fetchRefs(cwd, remote, refspecs, { token } = {}) {
  git(cwd, ['fetch', '--quiet', '--no-tags', remote, ...refspecs], { env: authEnv(token) });
}
