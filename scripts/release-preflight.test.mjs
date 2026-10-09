// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const cutRelease = readFileSync('.github/workflows/cut-release.yaml', 'utf8');
const e2e = readFileSync('.github/workflows/e2e.yaml', 'utf8');
const toolchain = readFileSync('.github/actions/setup-release-toolchain/action.yaml', 'utf8');
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
    for (const tool of ['dtolnay/rust-toolchain', 'setup:actionlint', 'pip install yamllint']) {
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
    expect(preflightJob).toContain(
      "if: github.event_name == 'workflow_dispatch' || github.ref == 'refs/heads/main'",
    );
  });
});
