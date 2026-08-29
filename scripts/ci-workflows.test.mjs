// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKOUT_SHA = 'd23441a48e516b6c34aea4fa41551a30e30af803';
const SETUP_NODE_SHA = '249970729cb0ef3589644e2896645e5dc5ba9c38';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('CI workflow contracts', () => {
  const ciWorkflow = read('.github/workflows/ci.yaml');
  const testsWorkflow = read('.github/workflows/tests.yaml');
  const setupAction = read('.github/actions/setup-node-pnpm/action.yaml');

  it('preserves the repository required check names', () => {
    expect(ciWorkflow).toContain('name: Build & Test');
    for (const project of ['renderer-ui', 'renderer-logic', 'main']) {
      expect(testsWorkflow).toContain(`name: Coverage (\${{ matrix.project }})`);
      expect(testsWorkflow).toContain(project);
    }
    expect(testsWorkflow).toContain('name: Merge coverage');
  });

  it('fans CI out behind one aggregate required check', () => {
    for (const job of ['changes:', 'quality:', 'typecheck:', 'app-build:', 'flatpak:', 'build:']) {
      expect(ciWorkflow).toContain(`  ${job}`);
    }
    expect(ciWorkflow).toContain('needs: [changes, quality, typecheck, app-build, flatpak]');
    expect(ciWorkflow).toContain('FLATPAK_RESULT: ${{ needs.flatpak.result }}');
    expect(ciWorkflow).toContain(
      '[[ "$FLATPAK_RESULT" == \'success\' || "$FLATPAK_RESULT" == \'skipped\' ]]',
    );
  });

  it('scopes pull request tests and keeps protected events on full coverage', () => {
    expect(testsWorkflow).toContain('run: node scripts/ci-test-scope.mjs');
    expect(testsWorkflow).toContain('VITEST_MODE: ${{ needs.changes.outputs.vitest_mode }}');
    expect(testsWorkflow).toContain('run: node scripts/ci-run-vitest.mjs');
    expect(testsWorkflow).toContain("needs.changes.outputs.vitest_mode == 'full'");
    expect(testsWorkflow).toContain("needs.changes.outputs.vitest_mode == 'related'");
    expect(testsWorkflow).toContain("needs.changes.outputs.vitest_mode == 'skip'");
  });

  it('cancels superseded runs and reuses the pinned dependency setup', () => {
    expect(ciWorkflow).toContain('cancel-in-progress: true');
    expect(testsWorkflow).toContain('cancel-in-progress: true');
    expect(ciWorkflow).toContain('uses: ./.github/actions/setup-node-pnpm');
    expect(testsWorkflow).toContain('uses: ./.github/actions/setup-node-pnpm');
    expect(setupAction).toContain('pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271');
    expect(setupAction).toContain(`actions/setup-node@${SETUP_NODE_SHA}`);
    expect(setupAction).toContain("default: '22.23.2'");
    expect(setupAction).toContain('pnpm install --frozen-lockfile');
  });

  it('pins checkout and removes persisted credentials before running repository code', () => {
    expect(ciWorkflow.match(new RegExp(`actions/checkout@${CHECKOUT_SHA}`, 'g'))).toHaveLength(5);
    expect(testsWorkflow.match(new RegExp(`actions/checkout@${CHECKOUT_SHA}`, 'g'))).toHaveLength(
      4,
    );
    expect(ciWorkflow.match(/persist-credentials: false/g)).toHaveLength(5);
    expect(testsWorkflow.match(/persist-credentials: false/g)).toHaveLength(4);
  });
});
