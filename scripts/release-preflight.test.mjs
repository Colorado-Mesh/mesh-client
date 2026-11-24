// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const cutRelease = readFileSync('.github/workflows/cut-release.yaml', 'utf8');
const e2e = readFileSync('.github/workflows/e2e.yaml', 'utf8');
const toolchain = readFileSync('.github/actions/setup-release-toolchain/action.yaml', 'utf8');
const ci = readFileSync('.github/workflows/ci.yaml', 'utf8');
const preflightJob = e2e.slice(e2e.indexOf('\n  release-preflight:'));

describe('Release preflight (e2e.yaml job)', () => {
  it('is a job in e2e.yaml, not a standalone PR workflow', () => {
    expect(e2e).toContain('\n  release-preflight:');
    expect(existsSync('.github/workflows/release-preflight.yaml')).toBe(false);
    expect(e2e).not.toMatch(/^\s*pull_request:/m);
  });

  it('shares the Node/pnpm and release toolchain composites with Cut release', () => {
    for (const workflow of [cutRelease, preflightJob]) {
      expect(workflow).toContain('uses: ./.github/actions/setup-node-pnpm');
      expect(workflow).toContain('uses: ./.github/actions/setup-release-toolchain');
    }
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
    expect(toolchain).not.toMatch(/requirements-semgrep|Install Semgrep/i);
    expect(cutRelease).not.toMatch(/uses: actions\/setup-node@/);
    expect(cutRelease).not.toMatch(/uses: pnpm\/action-setup@/);
  });

  it('does not install Semgrep in GitHub Actions (local pre-commit only)', () => {
    expect(toolchain).not.toMatch(/requirements-semgrep|check:semgrep|Install Semgrep/i);
    const e2eJob = e2e.slice(0, e2e.indexOf('\n  release-preflight:'));
    expect(e2eJob).not.toMatch(/requirements-semgrep|check:semgrep/i);
    expect(ci).not.toMatch(/requirements-semgrep|check:semgrep/i);
    const releaseSh = readFileSync('scripts/release.sh', 'utf8');
    expect(releaseSh).toMatch(/GITHUB_ACTIONS/);
    expect(releaseSh).toMatch(/check:semgrep/);
  });

  it('installs clippy with the Rust toolchain for check:environment', () => {
    expect(toolchain).toContain('dtolnay/rust-toolchain');
    expect(toolchain).toMatch(/components:\s*clippy/);
  });

  it('Electron E2E job installs Rust and yamllint before check:environment', () => {
    const e2eJob = e2e.slice(0, e2e.indexOf('\n  release-preflight:'));
    expect(e2eJob).toContain('dtolnay/rust-toolchain');
    expect(e2eJob).toMatch(/components:\s*clippy/);
    expect(e2eJob).toContain('scripts/requirements-yamllint.txt');
    expect(e2eJob).toContain('python3 -m venv');
    expect(e2eJob).not.toContain('requirements-semgrep.txt');
    expect(e2eJob).not.toContain('pip install --user semgrep');
    expect(e2eJob.indexOf('Setup Rust')).toBeLessThan(
      e2eJob.indexOf('Check environment (pre-install)'),
    );
    expect(e2eJob.indexOf('Install yamllint')).toBeLessThan(
      e2eJob.indexOf('Check environment (pre-install)'),
    );
  });

  it('runs release.sh pre-flight only, with tags and without push credentials', () => {
    expect(preflightJob).toContain('run: pnpm run release -- --preflight-only');
    expect(preflightJob).toMatch(/fetch-depth: 0/);
    expect(preflightJob).toMatch(/persist-credentials: false/);
    expect(preflightJob).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(preflightJob).not.toContain('RELEASE_PUSH_TOKEN');
    expect(preflightJob).toContain("MESH_CLIENT_RELEASE_PARSE_ONLY: ''");
    expect(preflightJob).toContain(
      "if: github.event_name == 'workflow_dispatch' || github.ref == 'refs/heads/main'",
    );
  });

  it('keeps the admin token out of checkout and release preparation', () => {
    expect(cutRelease).toMatch(/persist-credentials: false/);
    expect(cutRelease).not.toMatch(/^\s*token:\s*>-/m);
    expect(cutRelease).toContain('Prepare release without push credentials');
    expect(cutRelease).toContain('--prepare-only');
    expect(cutRelease).toContain('Push prepared release');
    expect(cutRelease).toContain('--push-only');

    const prepare = cutRelease.slice(
      cutRelease.indexOf('- name: Prepare release without push credentials'),
      cutRelease.indexOf('- name: Push prepared release'),
    );
    expect(prepare).not.toContain('RELEASE_CUT_TOKEN');
    expect(cutRelease).not.toContain('RELEASE_PUSH_TOKEN');

    const tokenRefs = cutRelease.match(/secrets\.RELEASE_CUT_TOKEN/g) ?? [];
    expect(tokenRefs).toHaveLength(1);
    expect(cutRelease).toContain('GIT_ASKPASS');
    expect(cutRelease).not.toMatch(/git remote set-url[^\n]*RELEASE_CUT_TOKEN/);
  });

  it('pins Semgrep for local setup via requirements-semgrep.txt', () => {
    const lock = readFileSync('scripts/requirements-semgrep.txt', 'utf8');
    expect(lock).toContain('semgrep==1.186.0');
  });

  it('installs yamllint from an exact wheel-only hash lock', () => {
    const lock = readFileSync('scripts/requirements-yamllint.txt', 'utf8');
    for (const requirement of ['yamllint==1.37.1', 'pathspec==0.12.1', 'PyYAML==6.0.4']) {
      expect(lock).toContain(requirement);
    }
    expect(toolchain).toContain('--require-hashes --only-binary=:all:');
    expect(lock.match(/--hash=sha256:/g)?.length).toBeGreaterThanOrEqual(9);
    expect(toolchain.indexOf('Install yamllint')).toBeGreaterThan(
      toolchain.indexOf('Install flatpak-node-generator'),
    );
  });
});
