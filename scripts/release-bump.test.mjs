// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'release-bump.mjs');
const METAINFO = 'flatpak/org.coloradomesh.MeshClient.metainfo.xml';
const TODAY = new Date().toISOString().slice(0, 10);
const dirs = [];

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const packageJson = (version) => `{\n  "name": "fixture",\n  "version": "${version}"\n}\n`;

/** @param {Array<[string, string]>} releases version and date pairs, newest first */
const metainfo = (releases) =>
  `<component>\n  <releases>\n${releases
    .map(([version, date]) => `    <release version="${version}" date="${date}"/>\n`)
    .join('')}  </releases>\n</component>\n`;

/**
 * A repository at a tagged v1.0.0 release with the two files the bump edits, and an
 * `origin/main` that points at that release, as a fresh fetch would.
 */
function releasedRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'mesh-release-bump-'));
  dirs.push(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'tag.gpgsign', 'false']);
  writeFileSync(path.join(repo, 'package.json'), packageJson('1.0.0'));
  mkdirSync(path.join(repo, 'flatpak'));
  writeFileSync(path.join(repo, METAINFO), metainfo([['1.0.0', '2026-01-01']]));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'chore: release v1.0.0']);
  git(repo, ['tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return repo;
}

/**
 * Main after a release promotion merged as 1.1.0 while its tag still waits for approval, and a
 * hotfix branch cut from it.
 */
function awaitingTag(repo) {
  writeFileSync(path.join(repo, 'package.json'), packageJson('1.1.0'));
  writeFileSync(
    path.join(repo, METAINFO),
    metainfo([
      ['1.1.0', '2026-02-01'],
      ['1.0.0', '2026-01-01'],
    ]),
  );
  git(repo, ['commit', '-q', '-am', 'chore: release v1.1.0']);
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(repo, ['switch', '-q', '-c', 'hotfix/crash']);
}

const bump = (repo, ...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8' });
const versionOf = (repo) =>
  JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
const metainfoOf = (repo) => readFileSync(path.join(repo, METAINFO), 'utf8');

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('release-bump CLI', () => {
  it('bumps package.json and MetaInfo from the latest release tag', () => {
    const repo = releasedRepo();
    const run = bump(repo, 'minor');
    expect(run.status, run.stderr).toBe(0);
    expect(versionOf(repo)).toBe('1.1.0');
    expect(metainfoOf(repo)).toBe(
      metainfo([
        ['1.1.0', TODAY],
        ['1.0.0', '2026-01-01'],
      ]),
    );
    expect(run.stdout).toContain('chore: release v1.1.0');
  });

  it('accepts an exact version after the pnpm argument separator', () => {
    const repo = releasedRepo();
    const run = bump(repo, '--', '1.0.5');
    expect(run.status, run.stderr).toBe(0);
    expect(versionOf(repo)).toBe('1.0.5');
  });

  it('refuses an unknown bump without touching the files', () => {
    const repo = releasedRepo();
    const before = readFileSync(path.join(repo, 'package.json'), 'utf8');
    const run = bump(repo, 'huge');
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Usage');
    expect(readFileSync(path.join(repo, 'package.json'), 'utf8')).toBe(before);
  });

  it('refuses a version that is not newer than the latest release', () => {
    const repo = releasedRepo();
    const run = bump(repo, '1.0.0');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('greater than 1.0.0');
  });

  it('counts from the version main carries while its release tag waits for approval', () => {
    const repo = releasedRepo();
    awaitingTag(repo);

    const run = bump(repo, 'patch');

    expect(run.status, run.stderr).toBe(0);
    expect(versionOf(repo)).toBe('1.1.1');
    expect(metainfoOf(repo)).toBe(
      metainfo([
        ['1.1.1', TODAY],
        ['1.1.0', '2026-02-01'],
        ['1.0.0', '2026-01-01'],
      ]),
    );
    expect(run.stdout).toContain('Bumped 1.1.0 -> 1.1.1');
  });

  it('refuses an exact version that is not above the version main carries', () => {
    const repo = releasedRepo();
    awaitingTag(repo);
    const before = readFileSync(path.join(repo, 'package.json'), 'utf8');

    const run = bump(repo, '1.0.5');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('greater than 1.1.0');
    expect(readFileSync(path.join(repo, 'package.json'), 'utf8')).toBe(before);
  });

  it('replaces its own earlier bump when run again after committing it', () => {
    const repo = releasedRepo();
    git(repo, ['switch', '-q', '-c', 'hotfix/crash']);
    expect(bump(repo, 'patch').status).toBe(0);
    git(repo, ['commit', '-q', '-am', 'chore: release v1.0.1']);

    const run = bump(repo, 'minor');

    expect(run.status, run.stderr).toBe(0);
    expect(versionOf(repo)).toBe('1.1.0');
    expect(metainfoOf(repo)).toBe(
      metainfo([
        ['1.1.0', TODAY],
        ['1.0.0', '2026-01-01'],
      ]),
    );
  });

  it('asks for a fetch when origin/main is missing', () => {
    const repo = releasedRepo();
    git(repo, ['update-ref', '-d', 'refs/remotes/origin/main']);
    const before = readFileSync(path.join(repo, 'package.json'), 'utf8');

    const run = bump(repo, 'patch');

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('git fetch origin main');
    expect(readFileSync(path.join(repo, 'package.json'), 'utf8')).toBe(before);
  });
});
