/**
 * The checks a release must pass before Cut release tags it, all from `.github/workflows/e2e.yaml`:
 * Electron E2E on each of its three operating systems and the release preflight. They run on
 * release pull requests, daily on main and by hand. The `Release gates` job in the same workflow
 * is the one check the main ruleset requires: it fails a release pull request unless all four
 * passed and passes at once elsewhere. Cut release reads the four gates themselves, never that
 * job, because merge groups report it green without running E2E.
 *
 * Each E2E leg is matched by its runner prefix, so moving a leg to a newer runner image still
 * matches, while a leg that disappears reads as never run. Tests pin these names against e2e.yaml
 * and the main ruleset.
 */

export const RELEASE_GATES_CHECK = 'Release gates';

/** @type {ReadonlyArray<{ label: string, prefix?: string, name?: string }>} */
export const REQUIRED_GATES = [
  { label: 'Electron E2E on Linux', prefix: 'Electron E2E (ubuntu-' },
  { label: 'Electron E2E on macOS', prefix: 'Electron E2E (macos-' },
  { label: 'Electron E2E on Windows', prefix: 'Electron E2E (windows-' },
  { label: 'Release preflight', name: 'Release preflight' },
];

/**
 * @typedef {{
 *   id: number,
 *   name: string,
 *   head_sha?: string,
 *   status: string,
 *   conclusion: string | null,
 *   app?: { id?: number } | null,
 * }} CheckRun
 */

/**
 * @param {{ prefix?: string, name?: string }} gate
 * @param {string} checkName
 * @returns {boolean}
 */
export function gateMatchesName(gate, checkName) {
  return gate.prefix ? checkName.startsWith(gate.prefix) : checkName === gate.name;
}

/**
 * The newest attempt of each check on each commit (by commit, app and name).
 * @param {CheckRun[]} checkRuns
 * @returns {CheckRun[]}
 */
function latestPerCommit(checkRuns) {
  /** @type {Map<string, CheckRun>} */
  const latest = new Map();
  for (const run of checkRuns) {
    const key = `${run.head_sha ?? ''}:${run.app?.id ?? 'unknown'}:${run.name}`;
    const current = latest.get(key);
    if (!current || run.id > current.id) latest.set(key, run);
  }
  return [...latest.values()];
}

/**
 * Whether the release gates passed, from the check runs of every commit that holds the tree
 * being released. A skipped run is no evidence either way (merge groups and other pull requests
 * skip E2E). A gate passes when it ran at least once and every newest run of it succeeded, so a
 * failure on any commit with the same tree blocks until that run is retried.
 * @param {CheckRun[]} checkRuns
 * @returns {{ ok: boolean, notPassed: string[] }} labels of the gates that did not pass, with why
 */
export function evaluateGates(checkRuns) {
  const ran = latestPerCommit(checkRuns).filter(
    (run) => !(run.status === 'completed' && run.conclusion === 'skipped'),
  );
  const notPassed = [];
  for (const gate of REQUIRED_GATES) {
    const runs = ran.filter((run) => gateMatchesName(gate, run.name));
    if (runs.length === 0) {
      notPassed.push(`${gate.label} (no run)`);
      continue;
    }
    const blocking = runs.find((run) => run.status !== 'completed' || run.conclusion !== 'success');
    if (blocking) {
      const state = blocking.status === 'completed' ? blocking.conclusion : blocking.status;
      notPassed.push(`${gate.label} (${state})`);
    }
  }
  return { ok: notPassed.length === 0, notPassed };
}
