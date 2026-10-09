// @vitest-environment node
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const cutRelease = readFileSync('.github/workflows/cut-release.yaml', 'utf8');
const preflight = readFileSync('.github/workflows/release-preflight.yaml', 'utf8');
const toolchain = readFileSync('.github/actions/setup-release-toolchain/action.yaml', 'utf8');

describe('Release preflight workflow', () => {
  it('shares the Node/pnpm and release toolchain composites with Cut release', () => {
    for (const workflow of [cutRelease, preflight]) {
      expect(workflow).toContain('uses: ./.github/actions/setup-node-pnpm');
      expect(workflow).toContain('uses: ./.github/actions/setup-release-toolchain');
    }
  });

  it('keeps release tooling in the composite, not inline in Cut release', () => {
    for (const tool of ['dtolnay/rust-toolchain', 'setup:actionlint', 'pip install yamllint']) {
      expect(toolchain).toContain(tool);
      expect(cutRelease).not.toContain(tool);
      expect(preflight).not.toContain(tool);
    }
    expect(cutRelease).not.toMatch(/uses: actions\/setup-node@/);
    expect(cutRelease).not.toMatch(/uses: pnpm\/action-setup@/);
  });

  it('runs release.sh pre-flight only, with tags and without push credentials', () => {
    expect(preflight).toContain('run: pnpm run release -- --preflight-only');
    expect(preflight).toMatch(/fetch-depth: 0/);
    expect(preflight).toMatch(/persist-credentials: false/);
    expect(preflight).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(preflight).not.toContain('RELEASE_PUSH_TOKEN');
    expect(preflight).toContain("MESH_CLIENT_RELEASE_PARSE_ONLY: ''");
  });

  it('triggers on PRs touching release plumbing, nightly, and on demand', () => {
    for (const p of [
      'scripts/release.sh',
      'scripts/clone-ratspeak-stack.sh',
      '.github/workflows/cut-release.yaml',
      '.github/workflows/release-preflight.yaml',
      '.github/actions/setup-node-pnpm/**',
      '.github/actions/setup-release-toolchain/**',
    ]) {
      expect(preflight).toContain(`- '${p}'`);
    }
    expect(preflight).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(preflight).toContain('workflow_dispatch:');
  });
});
