// @vitest-environment node
import { readFileSync } from 'node:fs';

import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  checkReleaseNotes,
  checkSchemaCallout,
  classifyPullRequest,
  DOCTOR_CHECK_NAME,
  gateMatchesName,
  renderSummary,
  REQUIRED_GATES,
  runDoctor,
  summarizeChecks,
} from './promotion-doctor.mjs';
import { commitTree, showFile, treeOf, treeWithFiles } from './promotionGit.mjs';
import { openPromotion } from './promotion-open.mjs';
import {
  cleanupRepos,
  FIXTURE_METAINFO,
  land,
  released,
  run,
  writeFiles,
} from './promotionTestRepos.mjs';
import { setPackageVersion } from './releaseVersion.mjs';

const REPO = 'Colorado-Mesh/mesh-client';
const PR = 7;

afterEach(() => {
  cleanupRepos();
});

const pull = (overrides = {}) => ({
  number: PR,
  title: 'Promote staging to main (v1.1.0)',
  body: '',
  draft: false,
  head: { ref: 'release/v1.1.0', sha: '0'.repeat(40), repo: { full_name: REPO } },
  base: { ref: 'main', repo: { full_name: REPO } },
  ...overrides,
});

const statusOf = (result, name) =>
  result.results.filter((entry) => entry.name === name).map((entry) => entry.status);
const detailOf = (result, name) =>
  result.results
    .filter((entry) => entry.name === name)
    .map((entry) => entry.detail)
    .join(' | ');
const failures = (result) => result.results.filter((entry) => entry.status === 'fail');

describe('classifyPullRequest', () => {
  it('recognises promotions by title, in any case', () => {
    expect(classifyPullRequest(pull(), { stagingExists: true })).toBe('promotion');
    expect(
      classifyPullRequest(pull({ title: 'promote Staging to Main (v6.9.0)' }), {
        stagingExists: true,
      }),
    ).toBe('promotion');
  });

  it('recognises hotfix branches and everything else', () => {
    const hotfix = pull({
      title: 'fix: crash',
      head: { ref: 'hotfix/crash', sha: 'x', repo: { full_name: REPO } },
    });
    const feature = pull({
      title: 'feat: x',
      head: { ref: 'feature/x', sha: 'x', repo: { full_name: REPO } },
    });
    expect(classifyPullRequest(hotfix, { stagingExists: true })).toBe('hotfix');
    expect(classifyPullRequest(feature, { stagingExists: true })).toBe('other');
  });

  it('treats every pull request as transition until staging exists', () => {
    expect(classifyPullRequest(pull(), { stagingExists: false })).toBe('transition');
    expect(classifyPullRequest(pull({ title: 'feat: x' }), { stagingExists: false })).toBe(
      'transition',
    );
  });
});

describe('summarizeChecks', () => {
  const runOf = (id, name, status, conclusion, appId = 15368) => ({
    id,
    name,
    status,
    conclusion,
    app: { id: appId },
  });

  it('keeps the latest attempt per name and app and sorts outcomes', () => {
    const summary = summarizeChecks({
      checkRuns: [
        runOf(1, 'Build & Test', 'completed', 'failure'),
        runOf(5, 'Build & Test', 'completed', 'success'),
        runOf(2, 'CodeQL', 'completed', 'neutral'),
        runOf(3, 'Panel matrix', 'completed', 'skipped'),
        runOf(4, 'E2E (macos)', 'in_progress', null),
        runOf(6, 'Coverage (main)', 'completed', 'cancelled'),
        runOf(7, 'Coverage (main)', 'completed', 'timed_out', 99),
        runOf(8, 'Bundle', 'completed', 'action_required'),
        runOf(9, DOCTOR_CHECK_NAME, 'completed', 'failure'),
      ],
      statuses: [
        { context: 'CodeRabbit', state: 'pending' },
        { context: 'Docs', state: 'success' },
        { context: 'Legacy', state: 'error' },
      ],
      selfName: DOCTOR_CHECK_NAME,
    });
    expect(summary.passing.sort()).toEqual(['Build & Test', 'CodeQL', 'Docs', 'Panel matrix']);
    expect(summary.pending.sort()).toEqual(['CodeRabbit', 'E2E (macos)']);
    expect(summary.failing.sort()).toEqual([
      'Bundle (action_required)',
      'Coverage (main) (cancelled)',
      'Coverage (main) (timed_out)',
      'Legacy (error)',
    ]);
  });
});

describe('checkReleaseNotes', () => {
  const commits = [
    { subject: 'feat: a (#1)', body: '' },
    { subject: 'fix: b (#2)', body: '' },
    { subject: 'docs: c (#3)', body: '' },
    { subject: 'chore: release v1.1.0', body: '' },
    { subject: 'chore: back-port main into staging', body: '' },
    { subject: 'Merge pull request #9 from team/branch', body: '' },
  ];

  it('names missing PR numbers', () => {
    const [result] = checkReleaseNotes({
      body: '## Release notes\n\n- feat: a (#1)\n- docs: c (#3)\n\n## Version\n\n#2 is not here',
      commits,
    });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('#2');
    expect(result.detail).not.toContain('#1');
  });

  it('passes when every shipped PR is listed, ignoring bookkeeping and merge commits', () => {
    const [result] = checkReleaseNotes({
      body: '## Release notes\n\n- #1\n- #2\n- #3\n',
      commits,
    });
    expect(result.status).toBe('pass');
  });

  it('fails without the heading', () => {
    expect(checkReleaseNotes({ body: 'Ships #1 #2 #3', commits })[0].status).toBe('fail');
  });
});

describe('checkSchemaCallout', () => {
  it('requires the upgrade to be named under the schema heading', () => {
    expect(checkSchemaCallout({ body: '', schemaMain: 54, schemaHead: 55 })[0].status).toBe('fail');
    expect(
      checkSchemaCallout({
        body: '## Database schema\n\nUpgrades from 54 to 55 (one-way).',
        schemaMain: 54,
        schemaHead: 55,
      })[0].status,
    ).toBe('pass');
    expect(
      checkSchemaCallout({
        body: '## Release notes\n\n54 55\n\n## Database schema\n\nUnchanged.',
        schemaMain: 54,
        schemaHead: 55,
      })[0].status,
    ).toBe('fail');
  });

  it('needs no section when the schema is unchanged', () => {
    expect(checkSchemaCallout({ body: '', schemaMain: 54, schemaHead: 54 })[0].status).toBe('pass');
  });
});

describe('renderSummary', () => {
  it('renders a table and keeps pipes in details from breaking it', () => {
    const markdown = renderSummary({
      kind: 'promotion',
      results: [{ name: 'Checks', status: 'fail', detail: 'a | b' }],
    });
    expect(markdown).toContain('| Check | Result | Detail |');
    expect(markdown).toContain('| Checks | FAIL | a \\| b |');
  });
});

/** Fake GitHub API over a real bare remote. */
function apiFor(remote, pr, { tags = [], checkRuns = [[]], statuses = [[]], mainShas } = {}) {
  let checkCall = 0;
  let statusCall = 0;
  let mainCall = 0;
  const branch = (name) => {
    try {
      return run(remote, ['rev-parse', '--verify', `refs/heads/${name}`]);
    } catch {
      return null;
    }
  };
  return {
    getPull: async () => pr,
    branchSha: async (name) =>
      name === 'main' && mainShas
        ? mainShas[Math.min(mainCall++, mainShas.length - 1)]
        : branch(name),
    listCheckRuns: async () => checkRuns[Math.min(checkCall++, checkRuns.length - 1)],
    combinedStatuses: async () => statuses[Math.min(statusCall++, statuses.length - 1)],
    tagExists: async (tag) => tags.includes(tag),
  };
}

/** Publish `sha` as pull request 7's head and return the pull request object. */
function publishPull(remote, branch, sha, overrides = {}) {
  run(remote, ['update-ref', 'refs/pull/7/head', sha]);
  return pull({ head: { ref: branch, sha, repo: { full_name: REPO } }, ...overrides });
}

async function promotion(fixture, options = {}) {
  let body = '';
  let title = '';
  const gh = (args, input) => {
    if (args[1] === 'list') return '[]';
    if (args[1] === 'create') {
      body = input;
      title = args[args.indexOf('--title') + 1];
      return 'https://example.test/pull/7';
    }
    return '';
  };
  const result = await openPromotion({
    cwd: fixture.user,
    remote: 'origin',
    bump: 'auto',
    dryRun: false,
    draft: false,
    today: '2026-11-20',
    gh,
    ...options,
  });
  const sha = run(fixture.remote, ['rev-parse', `refs/heads/${result.branch}`]);
  return { ...result, sha, body, title };
}

const doctor = (fixture, api, overrides = {}) =>
  runDoctor({
    prNumber: PR,
    cwd: fixture.user,
    api,
    remote: 'origin',
    token: undefined,
    requireGreenChecks: false,
    waitForChecks: false,
    timeoutMs: 0,
    pollMs: 0,
    sleep: async () => {},
    now: () => 0,
    ...overrides,
  });

/** Merge a promotion into main and leave its release tag unmade, as while approval is pending. */
function mergeWithoutTag(fixture, built) {
  run(fixture.remote, ['update-ref', 'refs/heads/main', built.sha]);
}

const HOTFIX_NOTES = '## Release notes\n\n- fix: crash (#9)\n';

/**
 * Push hotfix/crash cut from main: a fix, then a version bump to `version` with `releases`
 * (version and date pairs, newest first) as the MetaInfo list. Returns the head commit.
 */
function pushHotfix(fixture, version, releases) {
  run(fixture.seed, ['fetch', '-q', 'origin']);
  run(fixture.seed, ['checkout', '-q', '-B', 'hotfix/crash', 'origin/main']);
  writeFiles(fixture.seed, { 'crash.txt': 'fixed\n' });
  run(fixture.seed, ['add', '-A']);
  run(fixture.seed, ['commit', '-q', '-m', 'fix: crash (#9)']);
  writeFiles(fixture.seed, {
    'package.json': `{\n  "name": "fixture",\n  "version": "${version}"\n}\n`,
    [FIXTURE_METAINFO]: `<component>\n  <releases>\n${releases
      .map(([v, date]) => `    <release version="${v}" date="${date}"/>\n`)
      .join('')}  </releases>\n</component>\n`,
  });
  run(fixture.seed, ['commit', '-q', '-am', `chore: release v${version}`]);
  run(fixture.seed, ['push', '-q', 'origin', 'HEAD:hotfix/crash']);
  return run(fixture.remote, ['rev-parse', 'refs/heads/hotfix/crash']);
}

describe('runDoctor on promotions', { timeout: 60_000 }, () => {
  it('passes a canonical promotion', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(failures(result)).toEqual([]);
    expect(result).toMatchObject({ ok: true, kind: 'promotion' });
    for (const name of [
      'Promotion commit',
      'Built on current main',
      'Staging snapshot',
      'Same files as staging',
      'Release version',
      'Flatpak MetaInfo',
      'Release notes',
      'Database schema',
    ]) {
      expect(statusOf(result, name), name).toEqual(['pass']);
    }
  });

  it('accepts a snapshot that staging has since moved past', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    land(fixture.seed, 'staging', { 'later.txt': 'later\n' }, 'fix: later (#2)');
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result.ok).toBe(true);
    expect(statusOf(result, 'Staging moved on')).toEqual(['info']);
    expect(detailOf(result, 'Staging moved on')).toContain('1 newer');
  });

  it('fails a promotion that a newer version bump on staging superseded', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'a.txt': 'a\n' }, 'fix: a (#1)');
    const stale = await promotion(fixture);
    land(fixture.seed, 'staging', { 'b.txt': 'b\n' }, 'feat: b (#2)');
    await promotion(fixture);
    const pr = publishPull(fixture.remote, stale.branch, stale.sha, {
      title: stale.title,
      body: stale.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result.ok).toBe(false);
    expect(statusOf(result, 'Superseded')).toEqual(['fail']);
    expect(detailOf(result, 'Superseded')).toContain('chore: release v1.1.0');
    expect(statusOf(result, 'Staging moved on')).toEqual([]);
  });

  it('fails when main has moved past the first parent', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    land(fixture.seed, 'main', { 'hot.txt': 'hot\n' }, 'fix: hot (#3)');
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result.ok).toBe(false);
    expect(statusOf(result, 'Built on current main')).toEqual(['fail']);
  });

  it('fails when the tree differs from the staging snapshot', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    const [main, snapshot] = run(fixture.user, ['rev-list', '--parents', '-n', '1', built.sha])
      .split(' ')
      .slice(1);
    const tree = treeWithFiles(fixture.user, built.sha, { 'sneaky.txt': 'not on staging\n' });
    const bad = commitTree(fixture.user, { tree, parents: [main, snapshot], message: built.title });
    run(fixture.user, ['push', '-q', 'origin', `${bad}:refs/heads/release/bad-tree`]);
    const pr = publishPull(fixture.remote, 'release/bad-tree', bad, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(statusOf(result, 'Same files as staging')).toEqual(['fail']);
    expect(detailOf(result, 'Same files as staging')).toContain('sneaky.txt');
  });

  it('fails a head that is not a two-parent merge', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    const [main, snapshot] = run(fixture.user, ['rev-list', '--parents', '-n', '1', built.sha])
      .split(' ')
      .slice(1);
    const extra = run(fixture.user, ['rev-parse', `${snapshot}^`]);
    const bad = commitTree(fixture.user, {
      tree: treeOf(fixture.user, built.sha),
      parents: [main, snapshot, extra],
      message: built.title,
    });
    run(fixture.user, ['push', '-q', 'origin', `${bad}:refs/heads/release/three`]);
    const pr = publishPull(fixture.remote, 'release/three', bad, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(statusOf(result, 'Promotion commit')).toEqual(['fail']);
    expect(result.ok).toBe(false);
  });

  it('rejects fork promotions without reading them', async () => {
    const fixture = released();
    const pr = pull({
      head: {
        ref: 'release/v1.1.0',
        sha: 'f'.repeat(40),
        repo: { full_name: 'someone/mesh-client' },
      },
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result.ok).toBe(false);
    expect(statusOf(result, 'Head repository')).toEqual(['fail']);
  });

  it('fails a draft but still reports the other checks', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
      draft: true,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(statusOf(result, 'Ready for review')).toEqual(['fail']);
    expect(statusOf(result, 'Same files as staging')).toEqual(['pass']);
  });

  it('reports a promotion without a release', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'guide.md': 'guide\n' }, 'docs: guide (#7)');
    const built = await promotion(fixture, { bump: 'none' });
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result.ok).toBe(true);
    expect(statusOf(result, 'Release')).toEqual(['info']);
    expect(detailOf(result, 'Release')).toContain('No release');
  });

  it('reports no release over a version whose tag waits for approval', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    mergeWithoutTag(fixture, await promotion(fixture));
    land(fixture.seed, 'staging', { 'guide.md': 'guide\n' }, 'docs: guide (#7)');
    const built = await promotion(fixture, { bump: 'none' });
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(failures(result)).toEqual([]);
    expect(statusOf(result, 'Release')).toEqual(['info']);
    expect(detailOf(result, 'Release')).toContain('No release');
  });

  it('fails when the version is already tagged', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr, { tags: ['v1.1.0'] }));

    expect(statusOf(result, 'Release version')).toEqual(['fail']);
    expect(detailOf(result, 'Release version')).toContain('already tagged');
  });

  it('fails when MetaInfo does not match package.json', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    run(fixture.user, ['fetch', '-q', 'origin']);
    const main = run(fixture.user, ['rev-parse', 'origin/main']);
    const staging = run(fixture.user, ['rev-parse', 'origin/staging']);
    const packageText = setPackageVersion(showFile(fixture.user, staging, 'package.json'), '1.1.0');
    const bumped = commitTree(fixture.user, {
      tree: treeWithFiles(fixture.user, staging, { 'package.json': packageText }),
      parents: [staging],
      message: 'chore: release v1.1.0',
    });
    run(fixture.user, ['push', '-q', 'origin', `${bumped}:refs/heads/staging`]);
    const head = commitTree(fixture.user, {
      tree: treeOf(fixture.user, bumped),
      parents: [main, bumped],
      message: 'Promote staging to main (v1.1.0)',
    });
    run(fixture.user, ['push', '-q', 'origin', `${head}:refs/heads/release/v1.1.0`]);
    const pr = publishPull(fixture.remote, 'release/v1.1.0', head, {
      body: '## Release notes\n\n- feat: maps (#1)\n',
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(statusOf(result, 'Flatpak MetaInfo')).toEqual(['fail']);
    expect(statusOf(result, 'Release version')).toEqual(['pass']);
  });

  it('fails a hand-edited body that drops a shipped pull request', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'a.txt': 'a\n' }, 'feat: a (#1)');
    land(fixture.seed, 'staging', { 'b.txt': 'b\n' }, 'fix: b (#2)');
    const built = await promotion(fixture);
    const edited = built.body
      .split('\n')
      .filter((line) => !line.includes('(#2)'))
      .join('\n');
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: edited,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(statusOf(result, 'Release notes')).toEqual(['fail']);
    expect(detailOf(result, 'Release notes')).toContain('#2');
  });
});

describe('runDoctor on other pull requests', { timeout: 60_000 }, () => {
  it('fails a hotfix that carries staging work', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const stagingSha = run(fixture.remote, ['rev-parse', 'refs/heads/staging']);
    run(fixture.remote, ['update-ref', 'refs/heads/hotfix/bad', stagingSha]);
    const pr = publishPull(fixture.remote, 'hotfix/bad', stagingSha, { title: 'fix: crash' });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result).toMatchObject({ ok: false, kind: 'hotfix' });
    expect(statusOf(result, 'No staging work')).toEqual(['fail']);
  });

  it('passes a hotfix cut from main and reminds about the back-port', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    run(fixture.seed, ['checkout', '-q', '-B', 'hotfix/crash', 'origin/main']);
    run(fixture.seed, ['commit', '-q', '--allow-empty', '-m', 'fix: crash (#9)']);
    run(fixture.seed, ['push', '-q', 'origin', 'HEAD:hotfix/crash']);
    const sha = run(fixture.remote, ['rev-parse', 'refs/heads/hotfix/crash']);
    const pr = publishPull(fixture.remote, 'hotfix/crash', sha, { title: 'fix: crash' });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(failures(result)).toEqual([]);
    expect(result).toMatchObject({ ok: true, kind: 'hotfix' });
    expect(statusOf(result, 'Back-port')).toEqual(['info']);
  });

  it('fails a hotfix whose version is below the version main carries', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    mergeWithoutTag(fixture, await promotion(fixture));
    const sha = pushHotfix(fixture, '1.0.1', [
      ['1.0.1', '2026-11-21'],
      ['1.0.0', '2026-01-01'],
    ]);
    const pr = publishPull(fixture.remote, 'hotfix/crash', sha, {
      title: 'fix: crash',
      body: HOTFIX_NOTES,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result).toMatchObject({ ok: false, kind: 'hotfix' });
    expect(statusOf(result, 'Release version')).toEqual(['fail']);
    expect(detailOf(result, 'Release version')).toContain('1.1.0');
  });

  it('counts a releasing hotfix from the version main carries', async () => {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    mergeWithoutTag(fixture, await promotion(fixture));
    const sha = pushHotfix(fixture, '1.1.1', [
      ['1.1.1', '2026-11-21'],
      ['1.1.0', '2026-11-20'],
      ['1.0.0', '2026-01-01'],
    ]);
    const pr = publishPull(fixture.remote, 'hotfix/crash', sha, {
      title: 'fix: crash',
      body: HOTFIX_NOTES,
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(failures(result)).toEqual([]);
    expect(statusOf(result, 'Version choice')).toEqual([]);
    expect(detailOf(result, 'Release version')).toContain('v1.1.1');
    expect(detailOf(result, 'Release version')).toContain('1.1.0');
  });

  it('passes everything while staging does not exist yet', async () => {
    const fixture = released({ withStaging: false });
    const pr = pull({ title: 'feat: x' });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result).toMatchObject({ ok: true, kind: 'transition' });
  });

  it('asks other pull requests to target staging', async () => {
    const fixture = released();
    const pr = pull({
      title: 'feat: x',
      head: { ref: 'feature/x', sha: 'x', repo: { full_name: REPO } },
    });

    const result = await doctor(fixture, apiFor(fixture.remote, pr));

    expect(result).toMatchObject({ ok: false, kind: 'other' });
    expect(detailOf(result, 'Pull request target')).toContain('staging');
  });
});

describe('runDoctor green-check gate', { timeout: 60_000 }, () => {
  const job = (status, conclusion) => ({
    id: 1,
    name: 'Build & Test',
    status,
    conclusion,
    app: { id: 15368 },
  });
  // The check names e2e.yaml produced on a real pull request to main.
  const GATE_NAMES = [
    'Electron E2E (ubuntu-24.04)',
    'Electron E2E (macos-latest)',
    'Electron E2E (windows-latest)',
    'Release preflight',
  ];
  let nextId = 100;
  const checkRun = (name, status, conclusion) => ({
    id: nextId++,
    name,
    status,
    conclusion,
    app: { id: 15368 },
  });
  const gates = (status, conclusion) =>
    GATE_NAMES.map((name) => checkRun(name, status, conclusion));

  async function canonical() {
    const fixture = released();
    land(fixture.seed, 'staging', { 'maps.txt': 'maps\n' }, 'feat: maps (#1)');
    const built = await promotion(fixture);
    const pr = publishPull(fixture.remote, built.branch, built.sha, {
      title: built.title,
      body: built.body,
    });
    const mainSha = run(fixture.remote, ['rev-parse', 'refs/heads/main']);
    return { fixture, pr, mainSha };
  }

  it('waits for pending checks and then passes', async () => {
    const { fixture, pr } = await canonical();
    let sleeps = 0;
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [
        [job('in_progress', null), ...gates('in_progress', null)],
        [job('completed', 'success'), ...gates('completed', 'success')],
      ],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      sleep: async () => {
        sleeps += 1;
      },
    });

    expect(result.ok).toBe(true);
    expect(sleeps).toBe(1);
    expect(statusOf(result, 'Checks')).toEqual(['pass']);
  });

  it('fails with the pending names when the timeout passes', async () => {
    const { fixture, pr } = await canonical();
    let clock = 0;
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [[job('queued', null), ...gates('queued', null)]],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });

    expect(result.ok).toBe(false);
    expect(statusOf(result, 'Checks')).toEqual(['fail']);
    expect(detailOf(result, 'Checks')).toContain('Build & Test');
  });

  it('fails at once on a failing check', async () => {
    const { fixture, pr } = await canonical();
    let sleeps = 0;
    const api = apiFor(fixture.remote, pr, { checkRuns: [[job('completed', 'failure')]] });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      sleep: async () => {
        sleeps += 1;
      },
    });

    expect(result.ok).toBe(false);
    expect(sleeps).toBe(0);
    expect(detailOf(result, 'Checks')).toContain('Build & Test (failure)');
  });

  it('fails when main moves while the checks run', async () => {
    const { fixture, pr, mainSha } = await canonical();
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [
        [job('in_progress', null), ...gates('in_progress', null)],
        [job('completed', 'success'), ...gates('completed', 'success')],
      ],
      mainShas: [mainSha, 'e'.repeat(40)],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
    });

    expect(result.ok).toBe(false);
    expect(statusOf(result, 'Main moved')).toEqual(['fail']);
  });

  it('names the way to start the gates when none has run, instead of passing an empty list', async () => {
    const { fixture, pr } = await canonical();
    let clock = 0;
    const api = apiFor(fixture.remote, pr, { checkRuns: [[]] });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 10_000,
      startGraceMs: 1000,
      pollMs: 10,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });

    expect(result.ok).toBe(false);
    expect(clock).toBe(1200);
    expect(statusOf(result, 'Checks')).toEqual(['fail']);
    expect(detailOf(result, 'Checks')).toContain('No run of Electron E2E or Release preflight');
    expect(detailOf(result, 'Checks')).toContain('close and reopen it, or push a commit');
  });

  it('keeps waiting while only checks other than the gates have finished', async () => {
    const { fixture, pr } = await canonical();
    let sleeps = 0;
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [
        [job('completed', 'success')],
        [job('completed', 'success'), ...gates('completed', 'success')],
      ],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      sleep: async () => {
        sleeps += 1;
      },
    });

    expect(result.ok).toBe(true);
    expect(sleeps).toBe(1);
    expect(statusOf(result, 'Checks')).toEqual(['pass']);
  });

  it('names a gate that never started when the time runs out', async () => {
    const { fixture, pr } = await canonical();
    let clock = 0;
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [[job('completed', 'success'), ...gates('completed', 'success').slice(0, 3)]],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });

    expect(result.ok).toBe(false);
    expect(detailOf(result, 'Checks')).toBe('Not started: Release preflight.');
  });

  it('names each operating system that has no Electron E2E run', async () => {
    const { fixture, pr } = await canonical();
    let clock = 0;
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [
        [
          job('completed', 'success'),
          checkRun('Electron E2E (ubuntu-24.04)', 'completed', 'success'),
          checkRun('Release preflight', 'completed', 'success'),
        ],
      ],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      now: () => clock,
      sleep: async () => {
        clock += 600;
      },
    });

    expect(result.ok).toBe(false);
    expect(detailOf(result, 'Checks')).toBe(
      'Not started: Electron E2E on macOS, Electron E2E on Windows.',
    );
  });

  it('does not count a skipped gate as passed', async () => {
    const { fixture, pr } = await canonical();
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [
        [
          job('completed', 'success'),
          ...gates('completed', 'success').slice(0, 3),
          checkRun('Release preflight', 'completed', 'skipped'),
        ],
      ],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
    });

    expect(result.ok).toBe(false);
    expect(detailOf(result, 'Checks')).toBe('Failing: Release preflight (skipped).');
  });

  it('requires gates that e2e.yaml runs on every pull request to main', () => {
    const MATRIX_OS = /\$\{\{ matrix\.os \}\}/;
    const jobs = Object.entries(
      yaml.load(readFileSync('.github/workflows/e2e.yaml', 'utf8')).jobs,
    ).map(([id, definition]) => ({ ...definition, name: definition.name ?? id }));
    // One check per matrix leg, named as GitHub names it.
    const checks = jobs.flatMap((definition) =>
      MATRIX_OS.test(definition.name)
        ? definition.strategy.matrix.os.map((os) => ({
            name: definition.name.replace(MATRIX_OS, os),
            definition,
          }))
        : [{ name: definition.name, definition }],
    );
    for (const gate of REQUIRED_GATES) {
      const matching = checks.filter((check) => gateMatchesName(gate, check.name));
      expect(matching, gate.label).toHaveLength(1);
      expect(matching[0].definition.if, gate.label).toContain(
        "github.event_name == 'pull_request'",
      );
    }
    expect(
      checks
        .map((check) => check.name)
        .filter((name) => REQUIRED_GATES.some((gate) => gateMatchesName(gate, name))),
    ).toEqual(GATE_NAMES);
  });

  it('fails Superseded when staging gets a newer version bump while the checks run', async () => {
    const { fixture, pr } = await canonical();
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [
        [job('in_progress', null), ...gates('in_progress', null)],
        [job('completed', 'success'), ...gates('completed', 'success')],
      ],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      sleep: async () => {
        land(
          fixture.seed,
          'staging',
          { 'package.json': '{\n  "name": "fixture",\n  "version": "1.2.0"\n}\n' },
          'chore: release v1.2.0',
        );
      },
    });

    expect(result.ok).toBe(false);
    expect(statusOf(result, 'Checks')).toEqual(['pass']);
    expect(statusOf(result, 'Superseded')).toEqual(['fail']);
    expect(detailOf(result, 'Superseded')).toContain('chore: release v1.2.0');
  });

  it('still passes when staging gets other commits while the checks run', async () => {
    const { fixture, pr } = await canonical();
    const api = apiFor(fixture.remote, pr, {
      checkRuns: [
        [job('in_progress', null), ...gates('in_progress', null)],
        [job('completed', 'success'), ...gates('completed', 'success')],
      ],
    });

    const result = await doctor(fixture, api, {
      requireGreenChecks: true,
      waitForChecks: true,
      timeoutMs: 1000,
      pollMs: 10,
      sleep: async () => {
        land(fixture.seed, 'staging', { 'later.txt': 'later\n' }, 'fix: later (#2)');
      },
    });

    expect(result.ok).toBe(true);
    expect(statusOf(result, 'Superseded')).toEqual([]);
  });
});
