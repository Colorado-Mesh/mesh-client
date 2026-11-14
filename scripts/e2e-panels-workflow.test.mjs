// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/e2e-panels.yaml';
const SPEC_PATH = 'e2e/panelMatrix.spec.ts';

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

describe('Panel matrix E2E PR workflow', () => {
  it('matches a tracked file with every path pattern', () => {
    const unmatched = [...included, ...excluded].filter(
      (pattern) => !trackedFiles.some((file) => globToRegExp(pattern).test(file)),
    );
    expect(unmatched, 'path patterns that match no tracked file').toEqual([]);
  });

  it.each([
    'src/renderer/App.tsx',
    'src/renderer/lazyTabPanels.ts',
    'src/renderer/lazyAppPanels.ts',
    'src/renderer/components/ChatPanel.tsx',
    'src/renderer/lib/appTabMappings.ts',
    'src/renderer/lib/navSections.ts',
    'src/renderer/lib/panelLauncher.ts',
    'src/renderer/lib/tabSlotIds.ts',
    SPEC_PATH,
    'e2e/panelAnchors.ts',
    'e2e/electronApp.ts',
    'e2e/fixtures/meshcore-radio.ts',
    'playwright.config.ts',
    WORKFLOW_PATH,
  ])('runs for a change to %s', (file) => {
    expect(trackedFiles).toContain(file);
    expect(triggers(file)).toBe(true);
  });

  it.each([
    'src/renderer/components/ChatPanel.test.tsx',
    'src/renderer/lib/navSections.test.ts',
    'docs/ci-cd.md',
    'src/renderer/runtime/useMeshtasticRuntime.ts',
  ])('does not run for a change to %s alone', (file) => {
    expect(triggers(file)).toBe(false);
  });

  it('builds the app and runs only the panel matrix spec under xvfb on Linux', () => {
    const job = workflow.jobs.panels;
    expect(job['runs-on']).toBe('ubuntu-24.04');
    expect(existsSync(SPEC_PATH)).toBe(true);
    expect(existsSync('e2e/panelAnchors.ts')).toBe(true);
    const runs = job.steps.map((step) => step.run ?? '');
    expect(runs).toContain('pnpm run build');
    expect(runs).toContain(`xvfb-run -a pnpm exec playwright test ${SPEC_PATH}`);
    expect(job.steps.map((step) => step.uses)).toContain('./.github/actions/setup-node-pnpm');
  });

  it('installs the same Electron runtime libraries as the daily E2E Linux leg', () => {
    const daily = electronPackages(dailyE2e.jobs.e2e.steps);
    expect(daily.length).toBeGreaterThan(5);
    expect(electronPackages(workflow.jobs.panels.steps)).toEqual(daily);
  });

  it('uploads Playwright artifacts on failure', () => {
    const upload = workflow.jobs.panels.steps.find(
      (step) => step.name === 'Upload Playwright artifacts on failure',
    );
    expect(upload?.uses).toMatch(/^actions\/upload-artifact@/);
    expect(String(upload?.if ?? '')).toContain('failure()');
  });

  it('is not a merge queue gate, so it cannot be a required check', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});
