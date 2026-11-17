// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const cutRelease = readFileSync('.github/workflows/cut-release.yaml', 'utf8');
const e2e = readFileSync('.github/workflows/e2e.yaml', 'utf8');
const toolchain = readFileSync('.github/actions/setup-release-toolchain/action.yaml', 'utf8');
const preflightJob = e2e.slice(e2e.indexOf('\n  release-preflight:'));

describe('Release preflight (e2e.yaml job)', () => {
  it('is a job in e2e.yaml that gates only pull requests to main', () => {
    expect(e2e).toContain('\n  release-preflight:');
    expect(existsSync('.github/workflows/release-preflight.yaml')).toBe(false);
    // Promotions and hotfixes are the release gate; feature pull requests to staging skip it.
    expect(yaml.load(e2e).on.pull_request).toEqual({ branches: ['main'] });
  });

  it('runs the release tooling in the preflight job; Cut release only tags', () => {
    expect(preflightJob).toContain('uses: ./.github/actions/setup-node-pnpm');
    expect(preflightJob).toContain('uses: ./.github/actions/setup-release-toolchain');
    expect(cutRelease).toContain('uses: ./.github/actions/setup-node-pnpm');
    expect(cutRelease).not.toContain('setup-release-toolchain');
    expect(cutRelease).not.toContain('pnpm run release');
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
    // Schedules run on the default branch: staging after the switch, main before it.
    const guard =
      "github.event_name == 'workflow_dispatch' || github.event_name == 'pull_request' || " +
      "github.ref == 'refs/heads/staging' || github.ref == 'refs/heads/main'";
    const jobs = yaml.load(e2e).jobs;
    expect(jobs['release-preflight'].if).toBe(guard);
    expect(jobs.e2e.if).toBe(guard);
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
