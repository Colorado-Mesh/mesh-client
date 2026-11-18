// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import {
  dryRunLine,
  ghRunner,
  githubRepoFromRemoteUrl,
  nextSteps,
  openRelease,
  parseArgs,
  remoteRepository,
  sshHostname,
} from './release-open.mjs';
import { extractSection } from './releaseNotes.mjs';
import {
  cleanupRepos,
  FIXTURE_METAINFO as METAINFO,
  land,
  released,
  run,
} from './releaseTestRepos.mjs';

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

/**
 * Merge an open release pull request the way the squash merge queue lands it on main, and leave
 * its tag unmade, as while the Cut release approval is still pending.
 */
function squashMerge(seed, remote, fake, branch) {
  const pull = fake.pulls.find((pr) => pr.headRefName === branch);
  const files = Object.fromEntries(
    ['package.json', METAINFO].map((file) => [
      file,
      `${remoteGit(remote, ['show', `${branch}:${file}`])}\n`,
    ]),
  );
  const sha = land(seed, files, `${pull.title} (#${pull.number})`);
  pull.state = 'MERGED';
  return sha;
}

const open = (user, gh, overrides = {}) =>
  openRelease({
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
  it('defaults to an automatic bump from origin', () => {
    expect(parseArgs([])).toEqual({ bump: 'auto', dryRun: false, draft: false, remote: 'origin' });
  });

  it('reads bump, flags and remote in either flag form', () => {
    expect(
      parseArgs(['--', '--bump', 'minor', '--dry-run', '--draft', '--remote=upstream']),
    ).toEqual({ bump: 'minor', dryRun: true, draft: true, remote: 'upstream' });
    expect(parseArgs(['--bump=6.9.0']).bump).toBe('6.9.0');
  });

  it('refuses unknown flags and bump values, including none', () => {
    expect(() => parseArgs(['--bump', 'huge'])).toThrow(/Usage/);
    expect(() => parseArgs(['--bump', 'none'])).toThrow(/Usage/);
    expect(() => parseArgs(['--force'])).toThrow(/Usage/);
  });
});

describe('dryRunLine', () => {
  const title = 'chore: release v1.1.0';

  it('says what a dry run would push, open or update', () => {
    expect(dryRunLine({ branch: 'release/v1.0.1', title, pr: 42, push: true })).toBe(
      'Dry run: would push release/v1.0.1 and update #42 to "chore: release v1.1.0".',
    );
    expect(dryRunLine({ branch: 'release/v1.1.0', title, pr: null, push: true })).toBe(
      'Dry run: would push release/v1.1.0 and open "chore: release v1.1.0".',
    );
    expect(dryRunLine({ branch: 'release/v1.1.0', title, pr: 42, push: false })).toBe(
      'Dry run: release/v1.1.0 is current; would update #42 to "chore: release v1.1.0".',
    );
  });
});

describe('nextSteps', () => {
  const url = 'https://github.com/o/r/pull/6';
  const gates =
    'Next: wait for the Release gates check (Electron E2E on Linux, macOS and Windows, and the release preflight) on that pull request, get a review, and add it to the merge queue.';
  const tag =
    'Merging starts Cut release: approve its Tag release job (release-cut environment) to tag v6.10.0, then check the draft release once its artifacts are attached and publish it.';

  it('names the gates, the tag approval and the draft release', () => {
    expect(
      nextSteps({
        status: 'opened',
        version: '6.10.0',
        url,
        branch: 'release/v6.10.0',
        pushed: true,
      }),
    ).toEqual(['Opened https://github.com/o/r/pull/6', gates, tag]);
  });

  it('says when nothing was pushed and names the pull requests it closed', () => {
    const lines = nextSteps({
      status: 'updated',
      version: '6.10.0',
      url,
      branch: 'release/v6.10.0',
      pushed: false,
      superseded: [40, 37],
    });
    expect(lines).toEqual([
      'Updated https://github.com/o/r/pull/6',
      'release/v6.10.0 already held this release commit, so nothing was pushed and its checks keep their results.',
      'Closed #40 and #37 as superseded by this one.',
      gates,
      tag,
    ]);
  });
});

describe('githubRepoFromRemoteUrl', () => {
  const noSsh = () => {
    throw new Error('no ssh lookup expected');
  };

  it.each([
    'https://github.com/Owner/repo.git',
    'https://github.com/Owner/repo',
    'https://github.com/Owner/repo/',
    'https://someone:token@github.com/Owner/repo.git',
    'http://github.com/Owner/repo.git',
    'git@github.com:Owner/repo.git',
    'github.com:Owner/repo',
    'ssh://git@github.com/Owner/repo.git',
    'ssh://git@ssh.github.com:443/Owner/repo.git',
    'git+ssh://git@github.com/Owner/repo.git',
  ])('reads Owner/repo from %s', (url) => {
    expect(githubRepoFromRemoteUrl(url, noSsh)).toBe('Owner/repo');
  });

  it('follows an ssh host alias to github.com, and refuses one that leads elsewhere', () => {
    /** @type {Record<string, string>} */
    const hosts = { 'github-work': 'github.com', mirror: 'git.example.com' };
    const lookup = (/** @type {string} */ host) => hosts[host] ?? null;
    expect(githubRepoFromRemoteUrl('git@github-work:Owner/repo.git', lookup)).toBe('Owner/repo');
    expect(githubRepoFromRemoteUrl('ssh://git@github-work/Owner/repo.git', lookup)).toBe(
      'Owner/repo',
    );
    expect(githubRepoFromRemoteUrl('git@mirror:Owner/repo.git', lookup)).toBeNull();
  });

  it.each([
    'https://gitlab.com/Owner/repo.git',
    'https://github.example.com/Owner/repo.git',
    'https://github.com/Owner',
    'https://github.com/Owner/repo/extra',
    'file:///srv/repo.git',
    '/srv/remote.git',
    '../remote.git',
    'C:/Owner/repo',
  ])('refuses %s without an ssh lookup', (url) => {
    expect(githubRepoFromRemoteUrl(url, noSsh)).toBeNull();
  });
});

describe('sshHostname', () => {
  it('reads the hostname ssh -G resolves for a host alias', () => {
    /** @type {string[][]} */
    const calls = [];
    const exec = (/** @type {string} */ file, /** @type {string[]} */ args) => {
      calls.push([file, ...args]);
      return 'user git\nhostname github.com\nport 22\n';
    };
    expect(sshHostname('github-work', exec)).toBe('github.com');
    expect(calls).toEqual([['ssh', '-G', 'github-work']]);
  });

  it('never runs ssh for a host that could read as an option, and gives null when ssh fails', () => {
    const unexpected = () => {
      throw new Error('ssh must not run');
    };
    expect(sshHostname('-oProxyCommand=true', unexpected)).toBeNull();
    const failing = () => {
      throw new Error('ssh: command not found');
    };
    expect(sshHostname('github-work', failing)).toBeNull();
  });
});

describe('remoteRepository', () => {
  afterEach(() => cleanupRepos());

  /** @param {() => unknown} action @returns {string} */
  const failureOf = (action) => {
    try {
      action();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('expected a refusal');
  };

  it('reads the repository a remote pushes to, with insteadOf applied', () => {
    const { user } = released();
    run(user, ['remote', 'add', 'hub', 'https://github.com/Owner/repo.git']);
    run(user, ['config', 'url.https://github.com/.insteadOf', 'gh:']);
    run(user, ['remote', 'add', 'short', 'gh:Owner/short.git']);
    expect(remoteRepository(user, 'hub')).toBe('Owner/repo');
    expect(remoteRepository(user, 'short')).toBe('Owner/short');
  });

  it('refuses a remote that is not on github.com and never prints its URL', () => {
    const { user } = released();
    run(user, ['remote', 'add', 'other', 'https://someone:secret-value@git.example.com/o/r.git']);
    for (const remote of ['origin', 'other']) {
      const message = failureOf(() => remoteRepository(user, remote));
      expect(message).toContain(`Remote ${remote} is not a github.com repository`);
      expect(message).not.toContain('remote.git');
      expect(message).not.toContain('secret-value');
      expect(message).not.toContain('example.com');
    }
  });

  it('refuses a remote that fetches from one repository and pushes to another', () => {
    const { user } = released();
    run(user, ['remote', 'add', 'split', 'https://github.com/Owner/repo.git']);
    run(user, ['config', 'remote.split.pushurl', 'git@github.com:Fork/repo.git']);
    expect(failureOf(() => remoteRepository(user, 'split'))).toContain(
      'Remote split fetches from Owner/repo but pushes to Fork/repo',
    );
  });

  it('checks every URL git pushes to, not only the first', () => {
    const { user } = released();
    const addPush = (/** @type {string} */ remote, /** @type {string} */ url) =>
      run(user, ['remote', 'set-url', '--add', '--push', remote, url]);
    // Two push URLs: git push sends to both.
    run(user, ['remote', 'add', 'twin', 'https://github.com/Owner/repo.git']);
    addPush('twin', 'https://github.com/Owner/repo.git');
    addPush('twin', 'git@github.com:Other/mirror.git');
    expect(failureOf(() => remoteRepository(user, 'twin'))).toContain(
      'Remote twin fetches from Owner/repo but pushes to Other/mirror',
    );
    // Two URLs and no push URL: git push sends to both URLs.
    run(user, ['remote', 'add', 'pair', 'https://github.com/Owner/repo.git']);
    run(user, ['remote', 'set-url', '--add', 'pair', 'https://github.com/Other/second.git']);
    expect(failureOf(() => remoteRepository(user, 'pair'))).toContain(
      'Remote pair fetches from Owner/repo but pushes to Other/second',
    );
    // A second push URL off github.com: refused, and its URL is never printed.
    run(user, ['remote', 'add', 'mixed', 'https://github.com/Owner/repo.git']);
    addPush('mixed', 'https://github.com/Owner/repo.git');
    addPush('mixed', 'https://someone:secret-value@git.example.com/o/r.git');
    const mixed = failureOf(() => remoteRepository(user, 'mixed'));
    expect(mixed).toContain('Remote mixed is not a github.com repository');
    expect(mixed).not.toContain('secret-value');
    expect(mixed).not.toContain('example.com');
    // Every push URL naming the fetch repository is fine, in any URL form.
    run(user, ['remote', 'add', 'same', 'https://github.com/Owner/repo.git']);
    addPush('same', 'https://github.com/Owner/repo.git');
    addPush('same', 'git@github.com:Owner/repo.git');
    expect(remoteRepository(user, 'same')).toBe('Owner/repo');
  });
});

describe('ghRunner', () => {
  it('binds every gh call to the repository and passes its input on', () => {
    /** @type {Array<{ file: string, args: string[], cwd: string, input: unknown }>} */
    const calls = [];
    const exec = (
      /** @type {string} */ file,
      /** @type {string[]} */ args,
      /** @type {{ cwd: string, input?: string }} */ options,
    ) => {
      calls.push({ file, args, cwd: options.cwd, input: options.input });
      return 'out';
    };
    const gh = ghRunner('/work', 'Owner/repo', exec);
    expect(gh(['pr', 'list', '--base', 'main'])).toBe('out');
    gh(['pr', 'edit', '7', '--body-file', '-'], 'body text');
    expect(calls).toEqual([
      {
        file: 'gh',
        args: ['pr', 'list', '--base', 'main', '--repo', 'Owner/repo'],
        cwd: '/work',
        input: undefined,
      },
      {
        file: 'gh',
        args: ['pr', 'edit', '7', '--body-file', '-', '--repo', 'Owner/repo'],
        cwd: '/work',
        input: 'body text',
      },
    ]);
  });
});

// Each case builds real repositories and pushes to a bare remote: give CI room.
describe('openRelease', { timeout: 60_000 }, () => {
  it('opens a release pull request with one bump commit on the tip of main', async () => {
    const { remote, seed, user } = released();
    const mainSha = land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const { gh, calls } = fakeGh();

    const result = await open(user, gh);

    expect(result).toMatchObject({
      status: 'opened',
      version: '1.1.0',
      branch: 'release/v1.1.0',
      url: 'https://example.test/pull/42',
      pushed: true,
    });
    expect(remoteSha(remote, 'main')).toBe(mainSha);
    expect(parentsOf(remote, 'release/v1.1.0')).toEqual([mainSha]);
    expect(subjectOf(remote, 'release/v1.1.0')).toBe('chore: release v1.1.0');
    expect(remoteGit(remote, ['diff', '--name-only', mainSha, 'release/v1.1.0'])).toBe(
      ['flatpak/org.coloradomesh.MeshClient.metainfo.xml', 'package.json'].join('\n'),
    );
    expect(remoteGit(remote, ['show', 'release/v1.1.0:package.json'])).toContain(
      '"version": "1.1.0"',
    );
    expect(remoteGit(remote, ['show', `release/v1.1.0:${METAINFO}`])).toContain(
      '<releases>\n    <release version="1.1.0" date="2026-11-20"/>\n    <release version="1.0.0"',
    );
    const create = calls.find((call) => call.args[1] === 'create');
    expect(create.args).toEqual([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      'release/v1.1.0',
      '--title',
      'chore: release v1.1.0',
      '--body-file',
      '-',
    ]);
    expect(extractSection(create.input, '## Release notes')).toBe(
      '### Features\n\n- feat: maps (#1)',
    );
    expect(extractSection(create.input, '## Version')).toBe(
      '1.0.0 -> 1.1.0 (minor, detected from commit titles)',
    );
    expect(extractSection(create.input, '## Database schema')).toBe('Unchanged (schema 7).');
    const release = extractSection(create.input, '## Release');
    expect(release).toContain(`\`main\` at \`${mainSha.slice(0, 7)}\``);
    expect(release).toContain('since `v1.0.0`');
  });

  it('leaves its own version bump out of the risk callouts', async () => {
    const { seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const { gh, calls } = fakeGh();

    await open(user, gh);

    const create = calls.find((call) => call.args[1] === 'create');
    expect(extractSection(create.input, '## Risk callouts')).toBe('None detected.');
  });

  it('still calls out a shipped package.json change and a schema upgrade', async () => {
    const { seed, user } = released();
    land(
      seed,
      {
        'package.json':
          '{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": { "left-pad": "1.3.0" }\n}\n',
        'src/main/db-schema-sync.ts': 'export const CURRENT_SCHEMA_VERSION = 8;\n',
      },
      'fix: pin left-pad (#2)',
    );
    const { gh, calls } = fakeGh();

    await open(user, gh);

    const create = calls.find((call) => call.args[1] === 'create');
    expect(extractSection(create.input, '## Risk callouts')).toBe(
      [
        '- Dependencies changed (package.json, lockfile or patches)',
        '- Database code changed',
      ].join('\n'),
    );
    expect(extractSection(create.input, '## Database schema')).toContain('Upgrades from 7 to 8');
  });

  it('rebuilds the open release pull request on a newer main with one bump', async () => {
    const { remote, seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const { gh, calls } = fakeGh();
    await open(user, gh);
    const newMain = land(seed, { 'b.txt': 'b\n' }, 'fix: b (#2)');

    const result = await open(user, gh);

    expect(result).toMatchObject({ status: 'updated', version: '1.1.0', pushed: true });
    expect(parentsOf(remote, 'release/v1.1.0')).toEqual([newMain]);
    const subjects = remoteGit(remote, ['log', '--format=%s', 'release/v1.1.0']).split('\n');
    expect(subjects.filter((subject) => subject === 'chore: release v1.1.0')).toHaveLength(1);
    const metainfo = remoteGit(remote, ['show', `release/v1.1.0:${METAINFO}`]);
    expect(metainfo.match(/version="1\.1\.0"/g)).toHaveLength(1);
    const edit = calls.find((call) => call.args[1] === 'edit');
    expect(edit.args).toEqual([
      'pr',
      'edit',
      '42',
      '--title',
      'chore: release v1.1.0',
      '--body-file',
      '-',
    ]);
    expect(edit.input).toContain('- fix: b (#2)');
    expect(calls.filter((call) => call.args[1] === 'create')).toHaveLength(1);
  });

  it('pushes nothing when the release commit is already current, and refreshes the text', async () => {
    const { remote, seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const { gh, calls } = fakeGh();
    await open(user, gh);
    const before = remoteSha(remote, 'release/v1.1.0');

    const result = await open(user, gh);

    expect(result).toMatchObject({ status: 'updated', version: '1.1.0', pushed: false });
    expect(remoteSha(remote, 'release/v1.1.0')).toBe(before);
    expect(calls.filter((call) => call.args[1] === 'edit')).toHaveLength(1);
  });

  it('updates the open release pull request in place when the version changes', async () => {
    const { remote, seed, user } = released();
    land(seed, { 'a.txt': 'a\n' }, 'fix: a (#1)');
    const fake = fakeGh();
    expect(await open(user, fake.gh)).toMatchObject({ status: 'opened', version: '1.0.1' });
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#2)');

    const result = await open(user, fake.gh);

    expect(result).toMatchObject({ status: 'updated', version: '1.1.0', branch: 'release/v1.0.1' });
    expect(remoteGit(remote, ['show', 'release/v1.0.1:package.json'])).toContain(
      '"version": "1.1.0"',
    );
    expect(fake.pulls.map((pr) => [pr.number, pr.title, pr.state])).toEqual([
      [42, 'chore: release v1.1.0', 'OPEN'],
    ]);
  });

  it('closes other open release pull requests and leaves other branches and forks alone', async () => {
    const { seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const fake = fakeGh({
      prs: [
        {
          number: 38,
          headRefName: 'release/v2.0.0',
          title: 'chore: release v2.0.0',
          isCrossRepository: true,
        },
        { number: 39, headRefName: 'feature/x', title: 'chore: release v9.9.9' },
        {
          number: 40,
          headRefName: 'release/v1.0.1',
          title: 'chore: release v1.0.1',
          url: 'https://example.test/pull/40',
        },
        {
          number: 41,
          headRefName: 'release/v1.1.0',
          title: 'chore: release v1.1.0',
          url: 'https://example.test/pull/41',
        },
      ],
    });

    const result = await open(user, fake.gh);

    expect(result).toMatchObject({ status: 'updated', branch: 'release/v1.1.0', superseded: [40] });
    const close = fake.calls.find((call) => call.args[1] === 'close');
    expect(close.args).toEqual([
      'pr',
      'close',
      '40',
      '--comment',
      'Superseded by https://example.test/pull/41, which releases the current main.',
    ]);
    expect(fake.pulls.map((pr) => [pr.number, pr.state])).toEqual([
      [38, 'OPEN'],
      [39, 'OPEN'],
      [40, 'CLOSED'],
      [41, 'OPEN'],
    ]);
  });

  it('counts the next version from main while a merged release waits for its tag', async () => {
    const { remote, seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const fake = fakeGh();
    await open(user, fake.gh);
    squashMerge(seed, remote, fake, 'release/v1.1.0');
    land(seed, { 'c.txt': 'c\n' }, 'fix: c (#3)');

    const result = await open(user, fake.gh);

    expect(result).toMatchObject({ status: 'opened', version: '1.1.1', branch: 'release/v1.1.1' });
    const create = fake.calls.filter((call) => call.args[1] === 'create').at(-1);
    expect(extractSection(create.input, '## Release notes')).toBe('### Fixes\n\n- fix: c (#3)');
    expect(extractSection(create.input, '## Version')).toBe(
      '1.1.0 -> 1.1.1 (patch, detected from commit titles)',
    );
    expect(extractSection(create.input, '## Release')).toContain('since `v1.1.0`');
    expect(
      remoteGit(remote, ['show', `release/v1.1.1:${METAINFO}`])
        .split('\n')
        .filter((line) => line.includes('<release version=')),
    ).toEqual([
      '    <release version="1.1.1" date="2026-11-20"/>',
      '    <release version="1.1.0" date="2026-11-20"/>',
      '    <release version="1.0.0" date="2026-01-01"/>',
    ]);
  });

  it('reports nothing to release when main has no change since the latest release', async () => {
    const { remote, user } = released();
    const before = remoteRefs(remote);
    const { gh, calls } = fakeGh();

    expect(await open(user, gh)).toMatchObject({ status: 'nothing-to-release', version: '1.0.0' });
    expect(remoteRefs(remote)).toBe(before);
    expect(calls.filter((call) => call.args[1] !== 'list')).toEqual([]);
  });

  it('reports nothing to release when only a release waiting for its tag is new', async () => {
    const { remote, seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const fake = fakeGh();
    await open(user, fake.gh);
    squashMerge(seed, remote, fake, 'release/v1.1.0');

    expect(await open(user, fake.gh)).toMatchObject({
      status: 'nothing-to-release',
      version: '1.1.0',
    });
  });

  it('uses an explicit bump over the detected one', async () => {
    const { seed, user } = released();
    land(seed, { 'a.txt': 'a\n' }, 'fix: a (#1)');
    const { gh, calls } = fakeGh();

    expect(await open(user, gh, { bump: 'minor' })).toMatchObject({ version: '1.1.0' });
    const create = calls.find((call) => call.args[1] === 'create');
    expect(extractSection(create.input, '## Version')).toBe(
      '1.0.0 -> 1.1.0 (minor, chosen with --bump)',
    );
  });

  it('pushes nothing on a dry run and returns the body', async () => {
    const { remote, seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const before = remoteRefs(remote);
    const { gh, calls } = fakeGh();

    const result = await open(user, gh, { dryRun: true });

    expect(result).toMatchObject({
      status: 'dry-run',
      version: '1.1.0',
      branch: 'release/v1.1.0',
      pr: null,
      push: true,
      title: 'chore: release v1.1.0',
    });
    expect(result.body).toContain('- feat: maps (#1)');
    expect(remoteRefs(remote)).toBe(before);
    expect(calls.filter((call) => call.args[1] !== 'list')).toEqual([]);
  });

  it('names the open release pull request a dry run would update, and changes nothing', async () => {
    const { remote, seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const fake = fakeGh();
    await open(user, fake.gh);
    land(seed, { 'b.txt': 'b\n' }, 'fix: b (#2)');
    const before = remoteRefs(remote);

    const result = await open(user, fake.gh, { dryRun: true });

    expect(result).toMatchObject({
      status: 'dry-run',
      branch: 'release/v1.1.0',
      pr: 42,
      push: true,
    });
    expect(remoteRefs(remote)).toBe(before);
    expect(fake.calls.filter((call) => call.args[1] === 'edit')).toEqual([]);
  });

  it('opens a draft pull request with --draft', async () => {
    const { seed, user } = released();
    land(seed, { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const { gh, calls } = fakeGh();

    await open(user, gh, { draft: true });

    expect(calls.find((call) => call.args[1] === 'create').args.at(-1)).toBe('--draft');
  });
});
