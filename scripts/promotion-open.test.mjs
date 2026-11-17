// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import {
  backportLines,
  backportMainIntoStaging,
  dryRunLine,
  nextSteps,
  openPromotion,
  parseArgs,
} from './promotion-open.mjs';
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

/**
 * A stand-in for `gh` that keeps its pull requests and filters `pr list` by base, head and state
 * the way GitHub does, so a lookup that relies on the wrong filter fails here as it would there.
 * Created pull requests are numbered from 42.
 */
function fakeGh({ prs = [] } = {}) {
  const calls = [];
  const pulls = prs.map((pr) => ({
    baseRefName: 'main',
    state: 'OPEN',
    isCrossRepository: false,
    ...pr,
  }));
  let nextNumber = 42;
  const flag = (args, name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const byNumber = (value) => pulls.find((pr) => pr.number === Number(value));
  const gh = (args, input) => {
    calls.push({ args, input });
    const [noun, verb, target] = args;
    if (noun === 'pr' && verb === 'list') {
      const base = flag(args, '--base');
      const head = flag(args, '--head');
      const state = (flag(args, '--state') ?? 'open').toUpperCase();
      const fields = (flag(args, '--json') ?? '').split(',');
      const listed = pulls.filter(
        (pr) =>
          (!base || pr.baseRefName === base) &&
          (!head || pr.headRefName === head) &&
          pr.state === state,
      );
      return JSON.stringify(
        listed.map((pr) => Object.fromEntries(fields.map((field) => [field, pr[field]]))),
      );
    }
    if (noun === 'pr' && verb === 'create') {
      const number = nextNumber++;
      const url = `https://example.test/pull/${number}`;
      pulls.push({
        number,
        url,
        baseRefName: flag(args, '--base'),
        headRefName: flag(args, '--head'),
        title: flag(args, '--title'),
        state: 'OPEN',
        isCrossRepository: false,
      });
      return `${url}\n`;
    }
    if (noun === 'pr' && verb === 'edit') {
      byNumber(target).title = flag(args, '--title');
      return '';
    }
    if (noun === 'pr' && verb === 'close') {
      byNumber(target).state = 'CLOSED';
      return '';
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { gh, calls, pulls };
}

const HOTFIX_PACKAGE = (version) =>
  `{\n  "name": "fixture",\n  "description": "hotfixed",\n  "version": "${version}"\n}\n`;

/** Release v1.0.1 from main as a hotfix would: the fix, then its version bump, then the tag. */
function releaseHotfix(seed) {
  land(
    seed,
    'main',
    { 'hot.txt': 'fixed\n', 'package.json': HOTFIX_PACKAGE('1.0.0') },
    'fix: hotfix (#3)',
  );
  land(
    seed,
    'main',
    {
      'package.json': HOTFIX_PACKAGE('1.0.1'),
      [METAINFO]:
        '<component>\n  <releases>\n    <release version="1.0.1" date="2026-11-19"/>\n    <release version="1.0.0" date="2026-01-01"/>\n  </releases>\n</component>\n',
    },
    'chore: release v1.0.1',
  );
  run(seed, ['tag', '-a', 'v1.0.1', '-m', 'Release 1.0.1']);
  run(seed, ['push', '-q', 'origin', 'v1.0.1']);
}

const MERGED_METAINFO = [
  '<component>',
  '  <releases>',
  `    <release version="1.1.0" date="${TODAY}"/>`,
  '    <release version="1.0.1" date="2026-11-19"/>',
  '    <release version="1.0.0" date="2026-01-01"/>',
  '  </releases>',
  '</component>',
].join('\n');

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

describe('backportLines', () => {
  it('names the version files it resolved', () => {
    expect(
      backportLines(
        { status: 'merged', sha: 'abcdef1234567', resolved: [METAINFO, 'package.json'] },
        { dryRun: false },
      ),
    ).toEqual([
      'Pushed back-port merge abcdef1 to staging.',
      `Resolved ${METAINFO} and package.json: the higher version wins, and main's released MetaInfo entries stay below staging's unreleased one.`,
    ]);
  });

  it('reports a plain back-port, a dry run and nothing to do', () => {
    expect(backportLines({ status: 'merged', sha: 'abcdef1234567' }, { dryRun: true })).toEqual([
      'Would push back-port merge abcdef1 to staging.',
    ]);
    expect(backportLines({ status: 'not-needed' }, { dryRun: false })).toEqual([
      'staging already has everything main has; nothing to back-port.',
    ]);
  });
});

describe('dryRunLine', () => {
  it('says which pull request a dry run would update or open', () => {
    const title = 'Promote staging to main (v1.1.0)';
    expect(dryRunLine({ branch: 'release/v1.0.1', title, pr: 42 })).toBe(
      'Dry run: would push release/v1.0.1 and update #42 to "Promote staging to main (v1.1.0)".',
    );
    expect(dryRunLine({ branch: 'release/v1.1.0', title, pr: null })).toBe(
      'Dry run: would push release/v1.1.0 and open "Promote staging to main (v1.1.0)".',
    );
  });
});

describe('nextSteps', () => {
  it('names the promotions it closed as superseded', () => {
    const url = 'https://github.com/o/r/pull/41';
    expect(nextSteps({ status: 'updated', version: '1.1.0', url, superseded: [40] })).toContain(
      'Closed #40 as superseded by this one.',
    );
    expect(nextSteps({ status: 'updated', version: '1.1.0', url, superseded: [40, 37] })).toContain(
      'Closed #40 and #37 as superseded by this one.',
    );
  });

  const merge =
    'Next: wait for the Promotion Doctor and CI on that pull request, get a review, and merge it with a merge commit.';

  it('names the tag approval and the draft release for a release promotion', () => {
    expect(
      nextSteps({ status: 'opened', version: '6.10.0', url: 'https://github.com/o/r/pull/6' }),
    ).toEqual([
      'Opened https://github.com/o/r/pull/6',
      merge,
      'Merging starts Cut release: approve its Tag release job (release-cut environment) to tag v6.10.0, then check the draft release once its artifacts are attached and publish it.',
    ]);
  });

  it('says a promotion without a release tags nothing', () => {
    expect(
      nextSteps({ status: 'updated', version: null, url: 'https://github.com/o/r/pull/11' }),
    ).toEqual([
      'Updated https://github.com/o/r/pull/11',
      merge,
      'This promotion keeps the current version, so merging it tags no release.',
    ]);
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
    const { gh, calls } = fakeGh();
    await open(user, gh);
    land(seed, 'staging', { 'b.txt': 'b\n' }, 'fix: b (#2)');

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

  it('updates the open promotion in place when the version changes', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'a.txt': 'a\n' }, 'fix: a (#1)');
    const fake = fakeGh();
    expect(await open(user, fake.gh)).toMatchObject({ status: 'opened', version: '1.0.1' });
    land(seed, 'staging', { 'b.txt': 'b\n' }, 'feat: b (#2)');

    const result = await open(user, fake.gh);

    expect(result).toMatchObject({
      status: 'updated',
      version: '1.1.0',
      branch: 'release/v1.0.1',
      url: 'https://example.test/pull/42',
    });
    expect(fake.pulls.map((pr) => [pr.number, pr.state, pr.title])).toEqual([
      [42, 'OPEN', 'Promote staging to main (v1.1.0)'],
    ]);
    expect(parentsOf(remote, 'release/v1.0.1')).toEqual([
      remoteSha(remote, 'main'),
      remoteSha(remote, 'staging'),
    ]);
    expect(remoteGit(remote, ['branch', '--list', 'release/v1.1.0'])).toBe('');
  });

  it('closes other open promotions as superseded and leaves forks and hotfixes alone', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'b.txt': 'b\n' }, 'feat: b (#2)');
    const pull = (number, headRefName, title, extra = {}) => ({
      number,
      url: `https://example.test/pull/${number}`,
      headRefName,
      title,
      ...extra,
    });
    const fake = fakeGh({
      prs: [
        pull(38, 'hotfix/x', 'fix: x'),
        pull(39, 'release/v9.9.9', 'Promote staging to main (v9.9.9)', {
          isCrossRepository: true,
        }),
        pull(40, 'release/v1.0.1', 'Promote staging to main (v1.0.1)'),
        pull(41, 'release/promote-staging-2026-11-19', 'Promote staging to main (no release)'),
      ],
    });

    const result = await open(user, fake.gh);

    expect(result).toMatchObject({
      status: 'updated',
      version: '1.1.0',
      branch: 'release/promote-staging-2026-11-19',
      url: 'https://example.test/pull/41',
      superseded: [40],
    });
    expect(fake.pulls.map((pr) => [pr.number, pr.state])).toEqual([
      [38, 'OPEN'],
      [39, 'OPEN'],
      [40, 'CLOSED'],
      [41, 'OPEN'],
    ]);
    expect(fake.calls.find((call) => call.args[1] === 'close').args).toEqual([
      'pr',
      'close',
      '40',
      '--comment',
      'Superseded by https://example.test/pull/41, which promotes the current staging.',
    ]);
    expect(parentsOf(remote, 'release/promote-staging-2026-11-19')).toEqual([
      remoteSha(remote, 'main'),
      remoteSha(remote, 'staging'),
    ]);
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

  it('keeps one bump when main released a hotfix after the promotion opened', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'f.txt': 'f\n' }, 'feat: f (#4)');
    const { gh } = fakeGh();
    await open(user, gh);
    releaseHotfix(seed);

    const result = await open(user, gh);

    expect(result).toMatchObject({ status: 'updated', version: '1.1.0' });
    const subjects = remoteGit(remote, ['log', '--format=%s', 'staging']).split('\n');
    expect(subjects.filter((subject) => subject === 'chore: release v1.1.0')).toHaveLength(1);
    expect(subjects[0]).toBe('chore: back-port main into staging');
    expect(remoteGit(remote, ['show', `staging:${METAINFO}`])).toBe(MERGED_METAINFO);
    expect(parentsOf(remote, 'release/v1.1.0')).toEqual([
      remoteSha(remote, 'main'),
      remoteSha(remote, 'staging'),
    ]);
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

    expect(result).toMatchObject({
      status: 'dry-run',
      version: '1.1.0',
      branch: 'release/v1.1.0',
      pr: null,
    });
    expect(result.body).toContain('- feat: maps (#1)');
    expect(remoteRefs(remote)).toBe(before);
    expect(calls.map((call) => call.args[1])).toEqual(['list']);
  });

  it('names the open promotion a dry run would update, and changes nothing', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const before = remoteRefs(remote);
    const { gh, calls } = fakeGh({
      prs: [
        {
          number: 40,
          url: 'https://example.test/pull/40',
          headRefName: 'release/v1.0.1',
          title: 'Promote staging to main (v1.0.1)',
        },
      ],
    });

    const result = await open(user, gh, { dryRun: true });

    expect(result).toMatchObject({ status: 'dry-run', branch: 'release/v1.0.1', pr: 40 });
    expect(remoteRefs(remote)).toBe(before);
    expect(calls.map((call) => call.args[1])).toEqual(['list']);
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

  it('resolves the version files when main released a hotfix over an unreleased bump', async () => {
    const { remote, seed, user } = released();
    land(seed, 'staging', { 'f.txt': 'f\n' }, 'feat: f (#4)');
    await open(user, fakeGh().gh);
    releaseHotfix(seed);
    const mainSha = remoteSha(remote, 'main');
    const oldStaging = remoteSha(remote, 'staging');

    const result = backportMainIntoStaging({ cwd: user, remote: 'origin', dryRun: false });

    expect(result).toMatchObject({ status: 'merged', resolved: [METAINFO, 'package.json'] });
    expect(parentsOf(remote, 'staging')).toEqual([oldStaging, mainSha]);
    expect(remoteGit(remote, ['show', 'staging:hot.txt'])).toBe('fixed');
    expect(remoteGit(remote, ['show', 'staging:package.json'])).toBe(
      HOTFIX_PACKAGE('1.1.0').trim(),
    );
    expect(remoteGit(remote, ['show', `staging:${METAINFO}`])).toBe(MERGED_METAINFO);
  });

  it('still stops when the version files also conflict on other lines', async () => {
    const { remote, seed, user } = released();
    land(
      seed,
      'staging',
      { 'package.json': '{\n  "name": "fixture-staging",\n  "version": "1.0.0"\n}\n' },
      'feat: rename on staging (#4)',
    );
    await open(user, fakeGh().gh);
    releaseHotfix(seed);
    land(
      seed,
      'main',
      {
        'package.json':
          '{\n  "name": "fixture-main",\n  "description": "hotfixed",\n  "version": "1.0.1"\n}\n',
      },
      'fix: rename on main (#5)',
    );
    const before = remoteRefs(remote);

    expect(backportMainIntoStaging({ cwd: user, remote: 'origin', dryRun: false })).toEqual({
      status: 'conflict',
      conflicts: [METAINFO, 'package.json'],
    });
    expect(remoteRefs(remote)).toBe(before);
  });
});
