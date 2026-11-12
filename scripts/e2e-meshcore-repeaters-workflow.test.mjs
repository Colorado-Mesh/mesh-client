// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/e2e-meshcore-repeaters.yaml';
const SPEC_PATH = 'e2e/meshcore-repeater-admin.spec.ts';

const workflow = load(readFileSync(WORKFLOW_PATH, 'utf8'));
const dailyE2e = load(readFileSync('.github/workflows/e2e.yaml', 'utf8'));
const paths = workflow.on.pull_request.paths;
const included = paths.filter((pattern) => !pattern.startsWith('!'));
const excluded = paths.filter((pattern) => pattern.startsWith('!')).map((p) => p.slice(1));
// Untracked, non-ignored files count too, so the test also holds before a new file is staged.
const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
).split('\n');

/** GitHub `paths` globs: `*` stays inside one directory, `**` crosses directories. */
function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      source += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (ch === '*') {
      source += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(ch)) {
      source += `\\${ch}`;
    } else {
      source += ch;
    }
  }
  // eslint-disable-next-line security/detect-non-literal-regexp -- Patterns come from the checked-in workflow.
  return new RegExp(`^${source}$`);
}

const includeRes = included.map(globToRegExp);
const excludeRes = excluded.map(globToRegExp);
/** Whether a change to `file` alone starts the workflow (a later `!` pattern wins). */
const triggers = (file) =>
  includeRes.some((re) => re.test(file)) && !excludeRes.some((re) => re.test(file));

const electronPackages = (steps) => {
  const step = steps.find((s) => s.name === 'Install Linux Electron runtime libs + xvfb');
  const words = String(step?.run ?? '').split(/\s+/);
  return words.slice(words.indexOf('-y') + 1).filter((word) => word && word !== '\\');
};

describe('MeshCore repeater E2E PR workflow', () => {
  it('matches a tracked file with every path pattern', () => {
    const unmatched = [...included, ...excluded].filter(
      (pattern) => !trackedFiles.some((file) => globToRegExp(pattern).test(file)),
    );
    expect(unmatched, 'path patterns that match no tracked file').toEqual([]);
  });

  // The non-test files the ping fixes #1430, #1431, #1433 and #1441 changed.
  it.each([
    'src/renderer/runtime/useMeshcoreRuntime.ts',
    'src/renderer/lib/meshcoreRepeaterTracePath.ts',
    'src/renderer/lib/meshcoreTraceWirePath.ts',
    'src/renderer/lib/meshcoreRepeaterRouteEscalation.ts',
    'src/renderer/lib/meshcoreRadioContactPath.ts',
    'src/renderer/lib/meshcoreTracePathMultiplex.ts',
    'src/renderer/lib/meshcoreTraceRoutePrime.ts',
    'src/renderer/lib/meshcoreRoomLoginRouteResolve.ts',
    'src/renderer/lib/meshcoreUtils.ts',
    'src/renderer/lib/meshcore/meshcorePathUpdatedRuntime.ts',
    'src/renderer/lib/meshcore/meshcoreHookTypes.ts',
    'src/shared/meshcorePathHash.ts',
    SPEC_PATH,
    'e2e/fixtures/meshcore-repeater-radio.ts',
  ])('runs for a change to %s', (file) => {
    expect(trackedFiles).toContain(file);
    expect(triggers(file)).toBe(true);
  });

  it.each([
    'src/renderer/lib/meshcoreRepeaterTracePath.test.ts',
    'src/renderer/hooks/useMeshcoreRuntime.oneHopPingSynthesis.test.tsx',
    'docs/development/meshcore-repeaters.md',
    'src/renderer/lib/timeConstants.ts',
    'src/renderer/runtime/useMeshtasticRuntime.ts',
  ])('does not run for a change to %s alone', (file) => {
    expect(triggers(file)).toBe(false);
  });

  it('runs for the meshcore.js patch the workspace applies', () => {
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');
    const patch = /patches\/@liamcottle__meshcore\.js@[^\s'"]+\.patch/.exec(workspace)?.[0];
    expect(patch).toBeDefined();
    expect(triggers(String(patch))).toBe(true);
  });

  it('builds the app and runs only the repeater spec under xvfb on Linux', () => {
    const job = workflow.jobs.repeaters;
    expect(job['runs-on']).toBe('ubuntu-24.04');
    expect(existsSync(SPEC_PATH)).toBe(true);
    const runs = job.steps.map((step) => step.run ?? '');
    expect(runs).toContain('pnpm run build');
    expect(runs).toContain(`xvfb-run -a pnpm exec playwright test ${SPEC_PATH}`);
    expect(job.steps.map((step) => step.uses)).toContain('./.github/actions/setup-node-pnpm');
  });

  it('installs the same Electron runtime libraries as the daily E2E Linux leg', () => {
    const daily = electronPackages(dailyE2e.jobs.e2e.steps);
    expect(daily.length).toBeGreaterThan(5);
    expect(electronPackages(workflow.jobs.repeaters.steps)).toEqual(daily);
  });

  it('is not a merge queue gate, so it cannot be a required check', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});
