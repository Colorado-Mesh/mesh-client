// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKOUT_SHA = 'd23441a48e516b6c34aea4fa41551a30e30af803';
const SETUP_NODE_SHA = '249970729cb0ef3589644e2896645e5dc5ba9c38';
/** pnpm/action-setup v6.1.0 — required for pnpm 12 native bootstrap (esp. Windows). */
const PNPM_ACTION_SETUP_SHA = 'ea17c68df8912ef543352723c149a84f56e3d413';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/**
 * @param {string} haystack
 * @param {string} needle
 * @param {string} label
 * @returns {number}
 */
function requireIndex(haystack, needle, label) {
  const idx = haystack.indexOf(needle);
  expect(idx, label).toBeGreaterThan(-1);
  return idx;
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
    for (const job of [
      'changes:',
      'quality:',
      'lint:',
      'typecheck:',
      'app-build:',
      'flatpak:',
      'build:',
    ]) {
      expect(ciWorkflow).toContain(`  ${job}`);
    }
    expect(ciWorkflow).toContain('needs: [changes, quality, lint, typecheck, app-build, flatpak]');
    expect(ciWorkflow).toContain('FLATPAK_RESULT: ${{ needs.flatpak.result }}');
    expect(ciWorkflow).toContain(
      '[[ "$FLATPAK_RESULT" == \'success\' || "$FLATPAK_RESULT" == \'skipped\' ]]',
    );
  });

  it('blocks required coverage checks when detection or any shard fails', () => {
    const gate = testsWorkflow
      .split('      - name: Verify test shards')[1]
      .split('  reticulum-sidecar-coverage:')[0]
      .split('        run: |\n')[1];
    expect(testsWorkflow).toContain('needs: [changes, test-shards]');
    for (const changes of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const shards of ['success', 'failure', 'cancelled', 'skipped']) {
        const result = spawnSync('bash', ['-c', gate], {
          env: { ...process.env, CHANGES_RESULT: changes, SHARDS_RESULT: shards },
        });
        expect(result.status === 0).toBe(changes === 'success' && shards === 'success');
      }
    }
  });

  it.each(['LINT_RESULT', 'QUALITY_RESULT'])(
    'includes %s failure in the required build gate',
    (job) => {
      const gate = ciWorkflow
        .split('      - name: Verify CI fan-out')[1]
        .split('        run: |\n')[1];
      const success = {
        ...process.env,
        CHANGES_RESULT: 'success',
        QUALITY_RESULT: 'success',
        LINT_RESULT: 'success',
        TYPECHECK_RESULT: 'success',
        BUILD_RESULT: 'success',
        FLATPAK_RESULT: 'skipped',
        GITHUB_STEP_SUMMARY: '/dev/null',
      };
      for (const status of ['success', 'failure', 'cancelled', 'skipped']) {
        const result = spawnSync('bash', ['-c', gate], {
          env: { ...success, [job]: status },
        });
        expect(result.status === 0).toBe(status === 'success');
      }
    },
  );

  it('delegates only duplicate formatting rules to the required format check', async () => {
    const local = new ESLint({ cwd: ROOT });
    const ci = new ESLint({ cwd: ROOT, overrideConfigFile: 'eslint.ci.config.mjs' });
    const quality = ciWorkflow.split('  quality:')[1].split('  lint:')[0];
    expect(quality).toContain('run: pnpm run format:check');
    expect(quality).not.toMatch(/\bif:|continue-on-error:/);
    expect(ciWorkflow).toContain('pnpm run lint --concurrency 2 --config eslint.ci.config.mjs');
    const scripts = JSON.parse(read('package.json')).scripts;
    expect(scripts['format:check']).toContain('**/*.{ts,tsx,js,jsx,json,css,md,sh}');
    expect(scripts.lint).toBe('eslint . --max-warnings 0');

    for (const file of ['src/shared/tcpPort.ts', 'src/renderer/App.tsx', 'e2e/startup.spec.ts']) {
      const original = await local.calculateConfigForFile(file);
      const optimized = await ci.calculateConfigForFile(file);
      expect(original.rules['prettier/prettier'][0], file).toBe(2);
      expect(optimized.rules, file).toEqual({
        ...original.rules,
        'prettier/prettier': [0],
      });
    }
    // format:check does not include these extensions; preserve their existing rules.
    for (const file of ['vitest.harness.mts', 'scripts/electron-binary.mjs']) {
      expect((await ci.calculateConfigForFile(file)).rules, file).toEqual(
        (await local.calculateConfigForFile(file)).rules,
      );
    }
  });

  it('uses distinct artifact names for shards and bounds lint concurrency', () => {
    expect(testsWorkflow).toContain('name: vitest-blob-${{ matrix.project }}-${{ matrix.shard }}');
    expect(testsWorkflow).toContain('VITEST_SHARD: ${{ matrix.shard }}/${{ matrix.shards }}');
    expect(ciWorkflow).toContain('pnpm run lint --concurrency 2');
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
    expect(setupAction).toContain(`pnpm/action-setup@${PNPM_ACTION_SETUP_SHA}`);
    expect(setupAction).toContain(`actions/setup-node@${SETUP_NODE_SHA}`);
    expect(setupAction).toContain("default: '22.23.2'");
    expect(setupAction).toContain('pnpm install --frozen-lockfile');
    // pnpm 12 native bootstrap: Windows PowerShell hits silent .ps1 shims without this.
    const preferIdx = requireIndex(
      setupAction,
      'ci-prefer-windows-pnpm-exe.mjs',
      'setup-node-pnpm prefer helper',
    );
    const verifyIdx = requireIndex(
      setupAction,
      'ci-verify-pnpm.mjs',
      'setup-node-pnpm verify helper',
    );
    const installIdx = requireIndex(
      setupAction,
      'pnpm install --frozen-lockfile',
      'setup-node-pnpm install',
    );
    const setupNodeIdx = requireIndex(
      setupAction,
      `actions/setup-node@${SETUP_NODE_SHA}`,
      'setup-node-pnpm setup-node',
    );
    expect(preferIdx).toBeLessThan(setupNodeIdx);
    expect(preferIdx).toBeLessThan(installIdx);
    expect(setupNodeIdx).toBeLessThan(installIdx);
    expect(verifyIdx).toBeLessThan(installIdx);
    expect(setupAction).toMatch(
      /Prefer native pnpm\.exe on Windows PATH[\s\S]*?if: runner\.os == 'Windows'/,
    );
  });

  it('fixes Windows pnpm PATH and verifies pnpm before packaging installs', () => {
    for (const relativePath of [
      '.github/workflows/build.yaml',
      '.github/workflows/release.yaml',
      '.github/workflows/e2e.yaml',
    ]) {
      const yaml = read(relativePath);
      const preferIdx = requireIndex(
        yaml,
        'ci-prefer-windows-pnpm-exe.mjs',
        `${relativePath} prefer`,
      );
      const setupNodeIdx = requireIndex(yaml, 'actions/setup-node@', `${relativePath} setup-node`);
      const verifyIdx = requireIndex(yaml, 'ci-verify-pnpm.mjs', `${relativePath} verify`);
      const installIdx = requireIndex(
        yaml,
        'pnpm install --frozen-lockfile',
        `${relativePath} install`,
      );
      expect(preferIdx, relativePath).toBeLessThan(setupNodeIdx);
      expect(setupNodeIdx, relativePath).toBeLessThan(installIdx);
      expect(verifyIdx, relativePath).toBeLessThan(installIdx);
      expect(yaml, relativePath).toMatch(
        /Prefer native pnpm\.exe on Windows PATH[\s\S]*?if: runner\.os == 'Windows'[\s\S]*?ci-prefer-windows-pnpm-exe\.mjs/,
      );
    }
    expect(read('.github/workflows/build.yaml')).toContain('assert-win-setup-installers.mjs');
    expect(read('.github/workflows/release.yaml')).toContain('assert-win-setup-installers.mjs');
  });

  it('pins checkout and removes persisted credentials before running repository code', () => {
    expect(ciWorkflow.match(new RegExp(`actions/checkout@${CHECKOUT_SHA}`, 'g'))).toHaveLength(6);
    expect(testsWorkflow.match(new RegExp(`actions/checkout@${CHECKOUT_SHA}`, 'g'))).toHaveLength(
      4,
    );
    expect(ciWorkflow.match(/persist-credentials: false/g)).toHaveLength(6);
    expect(testsWorkflow.match(/persist-credentials: false/g)).toHaveLength(4);
  });
});
