// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { evaluateGates, gateMatchesName, REQUIRED_GATES } from './releaseGates.mjs';

const HEAD = 'h'.repeat(40);
const MERGED = 'm'.repeat(40);

let nextId = 1;
const check = (name, conclusion, { sha = HEAD, status = 'completed', id } = {}) => ({
  id: id ?? nextId++,
  name,
  head_sha: sha,
  status,
  conclusion: status === 'completed' ? conclusion : null,
  app: { id: 15368 },
});

const allGreen = (sha = HEAD) => [
  check('Electron E2E (ubuntu-24.04)', 'success', { sha }),
  check('Electron E2E (macos-latest)', 'success', { sha }),
  check('Electron E2E (windows-latest)', 'success', { sha }),
  check('Release preflight', 'success', { sha }),
];

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
