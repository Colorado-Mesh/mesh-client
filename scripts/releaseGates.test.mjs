// @vitest-environment node
import { readFileSync } from 'node:fs';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import {
  E2E_WORKFLOW_PATH,
  evaluateGates,
  gateMatchesName,
  GITHUB_ACTIONS_APP_ID,
  RELEASE_GATES_CHECK,
  REQUIRED_GATES,
} from './releaseGates.mjs';

const HEAD = 'h'.repeat(40);
const MERGED = 'm'.repeat(40);

let nextId = 1;
const check = (
  name,
  conclusion,
  {
    sha = HEAD,
    status = 'completed',
    id,
    appId = GITHUB_ACTIONS_APP_ID,
    workflowPath = E2E_WORKFLOW_PATH,
  } = {},
) => ({
  id: id ?? nextId++,
  name,
  head_sha: sha,
  status,
  conclusion: status === 'completed' ? conclusion : null,
  app: { id: appId },
  workflowPath,
});

const allGreen = (sha = HEAD) => [
  check('Electron E2E (ubuntu-24.04)', 'success', { sha }),
  check('Electron E2E (macos-latest)', 'success', { sha }),
  check('Electron E2E (windows-latest)', 'success', { sha }),
  check('Release preflight', 'success', { sha }),
];

describe('e2e.yaml', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/e2e.yaml', 'utf8'));

  it('reports each E2E gate from exactly one matrix leg and the preflight by its job name', () => {
    const legs = workflow.jobs.e2e.strategy.matrix.os.map((os) =>
      workflow.jobs.e2e.name.replace('${{ matrix.os }}', os),
    );
    expect(legs).toEqual([
      'Electron E2E (ubuntu-24.04)',
      'Electron E2E (macos-latest)',
      'Electron E2E (windows-latest)',
    ]);
    const names = [...legs, workflow.jobs['release-preflight'].name];
    for (const gate of REQUIRED_GATES) {
      expect(
        names.filter((name) => gateMatchesName(gate, name)),
        gate.label,
      ).toHaveLength(1);
    }
  });

  it('names the job that sums the gates up as the ruleset requires it', () => {
    expect(workflow.jobs['release-gates'].name).toBe(RELEASE_GATES_CHECK);
  });
});

describe('REQUIRED_GATES', () => {
  it('matches each E2E leg by its runner prefix and the preflight by name', () => {
    const [linux, macos, windows, preflight] = REQUIRED_GATES;
    expect(gateMatchesName(linux, 'Electron E2E (ubuntu-26.04)')).toBe(true);
    expect(gateMatchesName(linux, 'Electron E2E (macos-latest)')).toBe(false);
    expect(gateMatchesName(macos, 'Electron E2E (macos-15)')).toBe(true);
    expect(gateMatchesName(windows, 'Electron E2E (windows-2025)')).toBe(true);
    expect(gateMatchesName(preflight, 'Release preflight')).toBe(true);
    expect(gateMatchesName(preflight, 'Release preflight (old)')).toBe(false);
  });
});

describe('evaluateGates', () => {
  it('passes when every gate succeeded', () => {
    expect(evaluateGates(allGreen())).toEqual({ ok: true, notPassed: [] });
  });

  it('ignores skipped runs, which merge groups and other pull requests report', () => {
    const mergeGroup = [
      check('Electron E2E (${{ matrix.os }})', 'skipped', { sha: MERGED }),
      check('Release preflight', 'skipped', { sha: MERGED }),
    ];
    expect(evaluateGates([...mergeGroup, ...allGreen()])).toEqual({ ok: true, notPassed: [] });
    expect(evaluateGates(mergeGroup)).toEqual({
      ok: false,
      notPassed: [
        'Electron E2E on Linux (no run)',
        'Electron E2E on macOS (no run)',
        'Electron E2E on Windows (no run)',
        'Release preflight (no run)',
      ],
    });
  });

  it('blocks on a failure or an unfinished run, even beside a success on another commit', () => {
    const runs = [
      ...allGreen(),
      check('Electron E2E (ubuntu-24.04)', 'failure', { sha: MERGED }),
      check('Electron E2E (windows-latest)', null, { sha: MERGED, status: 'in_progress' }),
    ];
    expect(evaluateGates(runs)).toEqual({
      ok: false,
      notPassed: ['Electron E2E on Linux (failure)', 'Electron E2E on Windows (in_progress)'],
    });
  });

  it('counts only GitHub Actions runs from e2e.yaml, so a same-named check elsewhere passes nothing', () => {
    const others = [
      check('Release preflight', 'success', { appId: 99 }),
      check('Electron E2E (ubuntu-24.04)', 'success', {
        workflowPath: '.github/workflows/other.yaml',
      }),
      check('Electron E2E (macos-latest)', 'success', { workflowPath: null }),
    ];
    expect(evaluateGates(others).notPassed).toEqual([
      'Electron E2E on Linux (no run)',
      'Electron E2E on macOS (no run)',
      'Electron E2E on Windows (no run)',
      'Release preflight (no run)',
    ]);
  });

  it('never lets a newer same-named check from elsewhere hide a real failure', () => {
    const runs = [
      ...allGreen().filter((run) => run.name !== 'Release preflight'),
      check('Release preflight', 'failure', { id: 500 }),
      check('Release preflight', 'success', {
        id: 501,
        workflowPath: '.github/workflows/other.yaml',
      }),
    ];
    expect(evaluateGates(runs)).toEqual({ ok: false, notPassed: ['Release preflight (failure)'] });
  });

  it('reads the newest attempt of a re-run check', () => {
    const runs = [
      check('Electron E2E (macos-latest)', 'failure', { id: 900 }),
      check('Electron E2E (macos-latest)', 'success', { id: 901 }),
      ...allGreen().filter((run) => !run.name.startsWith('Electron E2E (macos-')),
    ];
    expect(evaluateGates(runs)).toEqual({ ok: true, notPassed: [] });
    expect(evaluateGates([...runs].reverse())).toEqual({ ok: true, notPassed: [] });
  });
});
