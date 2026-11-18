// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { RELEASE_GATES_CHECK } from './releaseGates.mjs';

const cutRelease = readFileSync('.github/workflows/cut-release.yaml', 'utf8');
const e2e = readFileSync('.github/workflows/e2e.yaml', 'utf8');
const e2eWorkflow = yaml.load(e2e);
const toolchain = readFileSync('.github/actions/setup-release-toolchain/action.yaml', 'utf8');
const preflightJob = e2e.slice(e2e.indexOf('\n  release-preflight:'));

/** A release pull request: one from this repository's release/ branch (release:open makes them). */
const RELEASE_PR =
  "github.event_name == 'pull_request' && startsWith(github.head_ref, 'release/') && " +
  'github.event.pull_request.head.repo.full_name == github.repository';
/** Where the E2E legs and the release preflight run: by hand, daily on main, release pull requests. */
const GATE_RUNS = `github.event_name == 'workflow_dispatch' || github.ref == 'refs/heads/main' || (${RELEASE_PR})`;

describe('Release preflight (e2e.yaml job)', () => {
  it('is a job in e2e.yaml, which runs for pull requests to main and merge groups', () => {
    expect(e2e).toContain('\n  release-preflight:');
    expect(existsSync('.github/workflows/release-preflight.yaml')).toBe(false);
    expect(e2eWorkflow.on.pull_request).toEqual({ branches: ['main'] });
    // The main ruleset requires Release gates, so it has to report in merge groups too.
    expect('merge_group' in e2eWorkflow.on).toBe(true);
    expect(Object.keys(e2eWorkflow.on).sort()).toEqual([
      'merge_group',
      'pull_request',
      'schedule',
      'workflow_dispatch',
    ]);
  });

  it('runs the E2E legs and the preflight only by hand, daily on main and on release pull requests', () => {
    expect(e2eWorkflow.jobs.e2e.if).toBe(GATE_RUNS);
    expect(e2eWorkflow.jobs['release-preflight'].if).toBe(GATE_RUNS);
  });

  it('runs the release tooling in the preflight job; Cut release only tags', () => {
    expect(preflightJob).toContain('uses: ./.github/actions/setup-node-pnpm');
    expect(preflightJob).toContain('uses: ./.github/actions/setup-release-toolchain');
    expect(cutRelease).toContain('uses: ./.github/actions/setup-node-pnpm');
    expect(cutRelease).not.toContain('setup-release-toolchain');
    // Its jobs never run scripts/release.sh (the header comment may name release:open).
    expect(JSON.stringify(yaml.load(cutRelease).jobs)).not.toContain('pnpm run release');
  });

  it('keeps release tooling in the composite, not inline in Cut release', () => {
    for (const tool of [
      'dtolnay/rust-toolchain',
      'setup:actionlint',
      'pip install --require-hashes --only-binary=:all:',
      'scripts/requirements-yamllint.txt',
    ]) {
      expect(toolchain).toContain(tool);
      expect(cutRelease).not.toContain(tool);
      expect(preflightJob).not.toContain(tool);
    }
    expect(cutRelease).not.toMatch(/uses: actions\/setup-node@/);
    expect(cutRelease).not.toMatch(/uses: pnpm\/action-setup@/);
  });

  it('runs release.sh pre-flight only, with tags and without push credentials', () => {
    expect(preflightJob).toContain('run: pnpm run release -- --preflight-only');
    expect(preflightJob).toMatch(/fetch-depth: 0/);
    expect(preflightJob).toMatch(/persist-credentials: false/);
    expect(preflightJob).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(preflightJob).not.toContain('RELEASE_PUSH_TOKEN');
    expect(preflightJob).toContain("MESH_CLIENT_RELEASE_PARSE_ONLY: ''");
  });

  it('keeps the admin token out of checkout, planning and tag creation', () => {
    expect(cutRelease).toMatch(/persist-credentials: false/);
    expect(cutRelease).not.toMatch(/^\s*token:\s*>-/m);

    const planJob = cutRelease.slice(
      cutRelease.indexOf('\n  plan:'),
      cutRelease.indexOf('\n  tag:'),
    );
    const prepare = cutRelease.slice(
      cutRelease.indexOf('\n  tag:'),
      cutRelease.indexOf('- name: Push release tag'),
    );
    expect(planJob).toContain('node scripts/release-tag-plan.mjs');
    expect(planJob).not.toContain('RELEASE_CUT_TOKEN');
    expect(prepare).toContain('- name: Create annotated tag');
    expect(prepare).not.toContain('RELEASE_CUT_TOKEN');
    expect(cutRelease).not.toContain('RELEASE_PUSH_TOKEN');

    const tokenRefs = cutRelease.match(/secrets\.RELEASE_CUT_TOKEN/g) ?? [];
    expect(tokenRefs).toHaveLength(1);
    expect(cutRelease).toContain('GIT_ASKPASS');
    expect(cutRelease).not.toMatch(/git remote set-url[^\n]*RELEASE_CUT_TOKEN/);
  });

  it('reports one Release gates check, the one the main ruleset requires', () => {
    const job = e2eWorkflow.jobs['release-gates'];
    expect(job.name).toBe(RELEASE_GATES_CHECK);
    expect(job.needs).toEqual(['e2e', 'release-preflight']);
    // Plain always(): with `&& !cancelled()` a cancelled run would skip this job, and GitHub
    // counts a skipped required check as passed.
    expect(job.if).toBe('always()');
    expect(job.permissions).toEqual({});
    // Not a matrix: a skipped matrix job does not report its expanded names.
    expect(job.strategy).toBeUndefined();
    const steps = job.steps.filter((step) => step.run);
    expect(steps).toHaveLength(1);
    expect(steps[0].env.RELEASE_PR).toBe('${{ ' + RELEASE_PR + ' }}');
    expect(steps[0].env.E2E_RESULT).toBe('${{ needs.e2e.result }}');
    expect(steps[0].env.PREFLIGHT_RESULT).toBe("${{ needs['release-preflight'].result }}");
    expect(steps[0].run).not.toContain('${{');
  });

  it.each([
    ['a release pull request whose gates passed', 'true', 'success', 'success', 0],
    ['a release pull request with a failed E2E leg', 'true', 'failure', 'success', 1],
    ['a release pull request whose preflight was cancelled', 'true', 'success', 'cancelled', 1],
    ['a release pull request whose gates were skipped', 'true', 'skipped', 'skipped', 1],
    ['another pull request or a merge group', 'false', 'skipped', 'skipped', 0],
    ['a daily or manual run that passed', 'false', 'success', 'success', 0],
    ['a daily or manual run with a failed leg', 'false', 'failure', 'success', 1],
    ['a run with only one gate skipped', 'false', 'skipped', 'success', 1],
  ])('Release gates decides %s', (_case, releasePr, e2eResult, preflightResult, code) => {
    const step = e2eWorkflow.jobs['release-gates'].steps.find((entry) => entry.run);
    const result = spawnSync('bash', ['-c', step.run], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RELEASE_PR: releasePr,
        E2E_RESULT: e2eResult,
        PREFLIGHT_RESULT: preflightResult,
      },
    });
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(code);
  });

  it('installs yamllint from an exact wheel-only hash lock', () => {
    const lock = readFileSync('scripts/requirements-yamllint.txt', 'utf8');
    for (const requirement of ['yamllint==1.37.1', 'pathspec==0.12.1', 'PyYAML==6.0.3']) {
      expect(lock).toContain(requirement);
    }
    expect(toolchain).toContain('--require-hashes --only-binary=:all:');
    expect(lock.match(/--hash=sha256:/g)?.length).toBeGreaterThanOrEqual(9);
    expect(toolchain.indexOf('Install yamllint')).toBeGreaterThan(
      toolchain.indexOf('Install flatpak-node-generator'),
    );
  });
});
