// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = '.github/workflows/e2e-meshtastic-chat.yaml';
const SPEC_PATH = 'e2e/meshtastic-chat.spec.ts';

const workflow = load(readFileSync(WORKFLOW_PATH, 'utf8'));
const dailyE2e = load(readFileSync('.github/workflows/e2e.yaml', 'utf8'));
const paths = workflow.on.pull_request.paths;
const included = paths.filter((pattern) => !pattern.startsWith('!'));
const excluded = paths.filter((pattern) => pattern.startsWith('!')).map((p) => p.slice(1));
const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
).split('\n');

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
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  return new RegExp(`^${source}$`); // eslint-disable-line security/detect-non-literal-regexp -- glob escaped above
}

const includeRes = included.map(globToRegExp);
const excludeRes = excluded.map(globToRegExp);
const triggers = (file) =>
  includeRes.some((re) => re.test(file)) && !excludeRes.some((re) => re.test(file));

const electronPackages = (steps) => {
  const step = steps.find((s) => s.name === 'Install Linux Electron runtime libs + xvfb');
  const words = String(step?.run ?? '').split(/\s+/);
  return words.slice(words.indexOf('-y') + 1).filter((word) => word && word !== '\\');
};

describe('Meshtastic chat E2E PR workflow', () => {
  it('matches a tracked file with every path pattern', () => {
    const unmatched = [...included, ...excluded].filter(
      (pattern) => !trackedFiles.some((file) => globToRegExp(pattern).test(file)),
    );
    expect(unmatched, 'path patterns that match no tracked file').toEqual([]);
  });

  it.each([
    'e2e/meshtastic-chat.spec.ts',
    'e2e/fixtures/meshtastic-tcp-radio.ts',
    'e2e/electronApp.ts',
    'playwright.config.ts',
  ])('triggers on %s', (file) => {
    expect(triggers(file)).toBe(true);
  });

  it('does not trigger on Meshtastic unit tests alone', () => {
    expect(triggers('src/renderer/lib/meshtastic/meshtasticAckProof.test.ts')).toBe(false);
  });

  it('uses contents: read permissions only', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('installs the same Electron runtime libraries as the daily E2E Linux leg', () => {
    const daily = electronPackages(dailyE2e.jobs.e2e.steps);
    expect(daily.length).toBeGreaterThan(5);
    expect(electronPackages(workflow.jobs.chat.steps)).toEqual(daily);
  });

  it('builds the app and runs only the Meshtastic chat spec under xvfb on Linux', () => {
    const job = workflow.jobs.chat;
    expect(job['runs-on']).toBe('ubuntu-24.04');
    const runs = job.steps.map((step) => step.run ?? '');
    expect(runs).toContain('pnpm run build');
    expect(runs).toContain(`xvfb-run -a pnpm exec playwright test ${SPEC_PATH}`);
  });

  it('is not a merge queue gate, so it cannot be a required check', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});
