/**
 * The checks a release must pass before Cut release tags it, all from `.github/workflows/e2e.yaml`:
 * Electron E2E on each of its three operating systems and the release preflight. They run on
 * release pull requests, daily on main and by hand. The `Release gates` job in the same workflow
 * is the one check the main ruleset requires: it fails a release pull request unless all four
 * passed and passes at once elsewhere. Cut release reads the four gates themselves, never that
 * job, because merge groups report it green without running E2E.
 *
 * Each E2E leg is matched by its runner prefix, so moving a leg to a newer runner image still
 * matches, while a leg that disappears reads as never run. Only check runs that GitHub Actions
 * made for e2e.yaml count, so a job with the same name in another workflow, or a check run from
 * another app, passes nothing. Tests pin these names against e2e.yaml and the main ruleset.
 */

export const RELEASE_GATES_CHECK = 'Release gates';
/** The GitHub Actions app, the same integration id the main ruleset pins its checks to. */
export const GITHUB_ACTIONS_APP_ID = 15368;
export const E2E_WORKFLOW_PATH = '.github/workflows/e2e.yaml';

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
 *   check_suite?: { id?: number } | null,
 *   workflowPath?: string | null,
 * }} CheckRun - `workflowPath` is the workflow file behind the run's check suite, added by the
 *   caller from the Actions API
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
 * @param {CheckRun} run
 * @returns {boolean} whether GitHub Actions made the run for e2e.yaml
 */
function fromE2eWorkflow(run) {
  return run.app?.id === GITHUB_ACTIONS_APP_ID && run.workflowPath === E2E_WORKFLOW_PATH;
}

/**
 * Whether the release gates passed, from the check runs of every commit that holds the tree
 * being released. Runs that did not come from e2e.yaml are dropped first, so they can neither
 * pass a gate nor hide a newer real run. A skipped run is no evidence either way (merge groups
 * and other pull requests skip E2E). A gate passes when it ran at least once and every newest run
 * of it succeeded, so a failure on any commit with the same tree blocks until that run is retried.
 * @param {CheckRun[]} checkRuns
 * @returns {{ ok: boolean, notPassed: string[] }} labels of the gates that did not pass, with why
 */
export function evaluateGates(checkRuns) {
  const ran = latestPerCommit(checkRuns.filter(fromE2eWorkflow)).filter(
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
