// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    expect(setupAction).toContain('pnpm install --frozen-lockfile');
  });
});
