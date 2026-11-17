// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { backportMainIntoStaging, openPromotion, parseArgs } from './promotion-open.mjs';
import { extractSection } from './promotionNotes.mjs';
import {
  cleanupRepos,
  FIXTURE_METAINFO as METAINFO,
  land,
  released,
  run,
} from './promotionTestRepos.mjs';

const TODAY = '2026-11-20';

const remoteGit = (remote, args) => run(remote, args);
const remoteSha = (remote, ref) => remoteGit(remote, ['rev-parse', ref]);
const remoteRefs = (remote) =>
  remoteGit(remote, ['for-each-ref', '--format=%(refname) %(objectname)']);
const parentsOf = (remote, ref) =>
  remoteGit(remote, ['rev-list', '--parents', '-n', '1', ref]).split(' ').slice(1);
const subjectOf = (remote, ref) => remoteGit(remote, ['log', '-1', '--format=%s', ref]);

function fakeGh({ existing = null } = {}) {
  const calls = [];
  const gh = (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(existing ? [existing] : []);
    if (args[0] === 'pr' && args[1] === 'create') return 'https://example.test/pull/42\n';
    if (args[0] === 'pr' && args[1] === 'edit') return '';
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { gh, calls };
}

const open = (user, gh, overrides = {}) =>
  openPromotion({
    cwd: user,
    remote: 'origin',
    bump: 'auto',
    dryRun: false,
    draft: false,
    today: TODAY,
    gh,
    ...overrides,
  });

afterEach(() => {
  cleanupRepos();
});

describe('parseArgs', () => {
  it('defaults to an automatic release from origin', () => {
    expect(parseArgs([])).toEqual({
      bump: 'auto',
      dryRun: false,
      draft: false,
      backportOnly: false,
      remote: 'origin',
    });
  });

  it('reads bump, flags and remote in either flag form', () => {
    expect(
      parseArgs(['--', '--bump', 'minor', '--dry-run', '--draft', '--remote=upstream']),
    ).toEqual({
      bump: 'minor',
      dryRun: true,
      draft: true,
      backportOnly: false,
      remote: 'upstream',
    });
    expect(parseArgs(['--bump=none', '--backport-only']).backportOnly).toBe(true);
    expect(parseArgs(['--bump=6.9.0']).bump).toBe('6.9.0');
  });

  it('refuses unknown flags and bump values', () => {
    expect(() => parseArgs(['--bump', 'huge'])).toThrow(/Usage/);
    expect(() => parseArgs(['--force'])).toThrow(/Usage/);
  });
});

// Each case builds real repositories and pushes to a bare remote: give CI room.
describe('openPromotion', { timeout: 60_000 }, () => {
  it('opens a release promotion', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const featureSha = remoteSha(remote, 'staging');
    const { gh, calls } = fakeGh();

    const result = await open(user, gh);

    expect(result).toMatchObject({
      status: 'opened',
      version: '1.1.0',
      branch: 'release/v1.1.0',
      url: 'https://example.test/pull/42',
    });
    expect(subjectOf(remote, 'staging')).toBe('chore: release v1.1.0');
    expect(parentsOf(remote, 'staging')).toEqual([featureSha]);
    expect(remoteGit(remote, ['show', 'staging:package.json'])).toContain('"version": "1.1.0"');
    expect(remoteGit(remote, ['show', `staging:${METAINFO}`])).toContain(
      '<releases>\n    <release version="1.1.0" date="2026-11-20"/>\n    <release version="1.0.0"',
    );
    expect(parentsOf(remote, 'release/v1.1.0')).toEqual([
      remoteSha(remote, 'main'),
      remoteSha(remote, 'staging'),
    ]);
    expect(remoteSha(remote, 'release/v1.1.0^{tree}')).toBe(remoteSha(remote, 'staging^{tree}'));
    const create = calls.find((call) => call.args[1] === 'create');
    expect(create.args).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'release/v1.1.0',
      '--title',
      'Promote staging to main (v1.1.0)',
      '--body-file',
      '-',
    ]);
    expect(create.input).toContain('## Release notes');
    expect(create.input).toContain('- feat: maps (#1)');
    expect(create.input).toContain('1.0.0 -> 1.1.0 (minor, detected from commit titles)');
  });

  it('leaves its own version bump out of the risk callouts', async () => {
    const { seed, user } = released();
    land(seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const { gh, calls } = fakeGh();

    await open(user, gh);

    const create = calls.find((call) => call.args[1] === 'create');
    expect(extractSection(create.input, '## Risk callouts')).toBe('None detected.');
  });

  it('still calls out a shipped package.json change', async () => {
    const { seed, user } = released();
    land(
      seed,
      'staging',
      {
        'package.json':
          '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": { "left-pad": "1.3.0" }\n}\n',
      },
      'fix: pin left-pad (#2)',
    );
    const { gh, calls } = fakeGh();

    await open(user, gh);

    const create = calls.find((call) => call.args[1] === 'create');
    expect(extractSection(create.input, '## Risk callouts')).toBe(
      '- Dependencies changed (package.json, lockfile or patches)',
    );
  });

  it('does not double-bump when run again after staging moves', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    await open(user, fakeGh().gh);
    land(seed, 'staging', { 'b.txt': 'b\n' }, 'fix: b (#2)');
    const { gh, calls } = fakeGh({ existing: { number: 42, url: 'https://example.test/pull/42' } });

    const result = await open(user, gh);

    expect(result).toMatchObject({ status: 'updated', version: '1.1.0' });
    const subjects = remoteGit(remote, ['log', '--format=%s', 'staging']).split('\n');
    expect(subjects.filter((subject) => subject === 'chore: release v1.1.0')).toHaveLength(1);
    expect(subjects[0]).toBe('fix: b (#2)');
    const metainfo = remoteGit(remote, ['show', `staging:${METAINFO}`]);
    expect(metainfo.match(/version="1\.1\.0"/g)).toHaveLength(1);
    expect(parentsOf(remote, 'release/v1.1.0')).toEqual([
      remoteSha(remote, 'main'),
      remoteSha(remote, 'staging'),
    ]);
    const edit = calls.find((call) => call.args[1] === 'edit');
    expect(edit.args).toEqual([
      'pr',
      'edit',
      '42',
      '--title',
      'Promote staging to main (v1.1.0)',
      '--body-file',
      '-',
    ]);
    expect(edit.input).toContain('- fix: b (#2)');
  });

  it('back-ports a hotfix as a merge commit before bumping', async () => {
    const { remote, seed, user } = released();
    land(seed, 'main', { 'hot.txt': 'fixed\n' }, 'fix: hotfix (#3)');
    land(seed, 'staging', { 'f.txt': 'f\n' }, 'feat: f (#4)');
    const mainSha = remoteSha(remote, 'main');
    const oldStaging = remoteSha(remote, 'staging');

    const result = await open(user, fakeGh().gh);

    expect(result).toMatchObject({ status: 'opened', version: '1.1.0' });
    expect(subjectOf(remote, 'staging')).toBe('chore: release v1.1.0');
    const [backport] = parentsOf(remote, 'staging');
    expect(subjectOf(remote, backport)).toBe('chore: back-port main into staging');
    expect(parentsOf(remote, backport)).toEqual([oldStaging, mainSha]);
    expect(remoteGit(remote, ['show', 'staging:hot.txt'])).toBe('fixed');
    expect(remoteSha(remote, 'release/v1.1.0^{tree}')).toBe(remoteSha(remote, 'staging^{tree}'));
  });

  it('stops on a conflicting back-port without pushing anything', async () => {
    const { remote, seed, user } = released();
    land(seed, 'main', { 'README.md': 'main\n' }, 'fix: readme on main (#5)');
    land(seed, 'staging', { 'README.md': 'staging\n' }, 'docs: readme on staging (#6)');
    const before = remoteRefs(remote);
    const { gh, calls } = fakeGh();

    const result = await open(user, gh);

    expect(result).toMatchObject({ status: 'conflict', conflicts: ['README.md'] });
    expect(remoteRefs(remote)).toBe(before);
    expect(calls).toEqual([]);
  });

  it('reports nothing to promote when staging is already in main', async () => {
    const { remote, user } = released();
    const before = remoteRefs(remote);
    const { gh, calls } = fakeGh();

    expect(await open(user, gh)).toMatchObject({ status: 'nothing-to-promote' });
    expect(remoteRefs(remote)).toBe(before);
    expect(calls).toEqual([]);
  });

  it('stops before rollout when the remote has no staging branch', async () => {
    const { user } = released({ withStaging: false });
    const { gh, calls } = fakeGh();
    expect(await open(user, gh)).toMatchObject({ status: 'no-staging' });
    expect(calls).toEqual([]);
  });

  it('builds a promotion without a release for --bump none', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'guide.md': 'guide\n' }, 'docs: guide (#7)');
    const stagingBefore = remoteSha(remote, 'staging');
    const { gh, calls } = fakeGh();

    const result = await open(user, gh, { bump: 'none' });

    expect(result).toMatchObject({
      status: 'opened',
      version: null,
      branch: 'release/promote-staging-2026-11-20',
    });
    expect(remoteSha(remote, 'staging')).toBe(stagingBefore);
    const create = calls.find((call) => call.args[1] === 'create');
    expect(create.args).toContain('Promote staging to main (no release)');
    expect(create.input).toContain('1.0.0 (no release)');
  });

  it('pushes nothing on a dry run and returns the body', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const before = remoteRefs(remote);
    const { gh, calls } = fakeGh();

    const result = await open(user, gh, { dryRun: true });

    expect(result).toMatchObject({ status: 'dry-run', version: '1.1.0', branch: 'release/v1.1.0' });
    expect(result.body).toContain('- feat: maps (#1)');
    expect(remoteRefs(remote)).toBe(before);
    expect(calls).toEqual([]);
  });

  it('opens a draft pull request with --draft', async () => {
    const { seed, user } = released();
    land(seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const { gh, calls } = fakeGh();

    await open(user, gh, { draft: true });

    expect(calls.find((call) => call.args[1] === 'create').args).toContain('--draft');
  });
});

describe('backportMainIntoStaging', { timeout: 60_000 }, () => {
  it('merges main into staging as a real merge commit', () => {
    const { remote, seed, user } = released();
    land(seed, 'main', { 'hot.txt': 'fixed\n' }, 'fix: hotfix (#3)');
    land(seed, 'staging', { 'f.txt': 'f\n' }, 'feat: f (#4)');
    const mainSha = remoteSha(remote, 'main');
    const oldStaging = remoteSha(remote, 'staging');

    const result = backportMainIntoStaging({ cwd: user, remote: 'origin', dryRun: false });

    expect(result.status).toBe('merged');
    expect(remoteSha(remote, 'staging')).toBe(result.sha);
    expect(parentsOf(remote, 'staging')).toEqual([oldStaging, mainSha]);
  });

  it('does nothing when staging already has everything main has', () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'f.txt': 'f\n' }, 'feat: f (#4)');
    const before = remoteRefs(remote);
    expect(backportMainIntoStaging({ cwd: user, remote: 'origin', dryRun: false })).toEqual({
      status: 'not-needed',
    });
    expect(remoteRefs(remote)).toBe(before);
  });

  it('reports conflicts and leaves the remote alone', () => {
    const { remote, seed, user } = released();
    land(seed, 'main', { 'README.md': 'main\n' }, 'fix: readme on main (#5)');
    land(seed, 'staging', { 'README.md': 'staging\n' }, 'docs: readme on staging (#6)');
    const before = remoteRefs(remote);
    expect(backportMainIntoStaging({ cwd: user, remote: 'origin', dryRun: false })).toEqual({
      status: 'conflict',
      conflicts: ['README.md'],
    });
    expect(remoteRefs(remote)).toBe(before);
  });
});
