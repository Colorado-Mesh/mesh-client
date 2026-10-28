// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

import { planCiTests } from './ci-test-scope.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = load(
  fs.readFileSync(path.join(ROOT, '.github/workflows/bundle-size.yaml'), 'utf8'),
);
const job = workflow.jobs['bundle-size'];
const command = job.steps
  .find((step) => step.name === 'Validate production main bundle')
  .run.trim();

describe('always-on bundle workflow', () => {
  it('runs for all PR targets and changes, including draft and retarget events', () => {
    expect(workflow.on.pull_request).toEqual({
      types: [
        'opened',
        'synchronize',
        'reopened',
        'edited',
        'ready_for_review',
        'converted_to_draft',
      ],
    });
    expect(workflow.on).not.toHaveProperty('pull_request_target');
    expect(workflow.on).toHaveProperty('merge_group');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(workflow.on.push).toEqual({ branches: ['main'] });
  });

  it.each([
    [[], 'skip'],
    [['docs/ci-cd.md'], 'skip'],
    [['src/main/link-preview.ts'], 'related'],
    [['src/renderer/App.tsx'], 'related'],
    [['.github/workflows/bundle-size.yaml'], 'full'],
  ])('runs independently of scope selection for %j (%s)', (paths, mode) => {
    expect(planCiTests('pull_request', paths).mode).toBe(mode);
    expect(job).not.toHaveProperty('needs');
    expect(job).not.toHaveProperty('if');
    expect(job.steps.every((step) => !Object.hasOwn(step, 'if'))).toBe(true);
    expect(command).toBe(
      'pnpm exec vitest run --project main scripts/esbuild-main-build.test.mjs --coverage.enabled=false --reporter=default',
    );
  });

  it('uses the shared frozen toolchain on the merge ref with read-only fork-safe permissions', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job).not.toHaveProperty('permissions');
    expect(job).not.toHaveProperty('secrets');
    expect(job).not.toHaveProperty('environment');
    expect(job.steps).toHaveLength(3);
    expect(job.steps[0]).toEqual({
      uses: 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      with: { 'persist-credentials': false },
    });
    expect(job.steps[1]).toEqual({ uses: './.github/actions/setup-node-pnpm' });
    expect(JSON.stringify(workflow)).not.toMatch(
      /secrets\.|pull_request\.head\.repo|continue-on-error/,
    );
  });

  it.each([
    ['under budget', 110_000, 0],
    ['over budget', 752_883, 1],
    ['missing suite', null, 1],
  ])(
    'the actual command fails closed with %s and empty related selection',
    (_label, bytes, status) => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-bundle-ci-'));
      try {
        fs.symlinkSync(
          path.join(ROOT, 'node_modules'),
          path.join(fixture, 'node_modules'),
          'junction',
        );
        fs.writeFileSync(path.join(fixture, 'package.json'), '{"type":"module"}');
        fs.writeFileSync(
          path.join(fixture, 'vitest.config.mts'),
          `export default { test: { projects: [{ test: { name: 'main', include: ['scripts/**/*.test.mjs'], maxWorkers: 1 } }] } };`,
        );
        fs.mkdirSync(path.join(fixture, 'scripts'));
        if (bytes !== null) {
          for (const file of [
            'scripts/esbuild-main-build.test.mjs',
            'scripts/esbuild-main-build.mjs',
            'scripts/esbuild-main-externals.mjs',
          ]) {
            fs.copyFileSync(path.join(ROOT, file), path.join(fixture, file));
          }
          for (const directory of ['src/main/translation/vendor', 'src/main/ai/vendor']) {
            fs.mkdirSync(path.join(fixture, directory), { recursive: true });
            for (const file of fs.readdirSync(path.join(ROOT, directory))) {
              if (/^(LICENSE.*\.txt|README\.md)$/.test(file)) {
                fs.copyFileSync(
                  path.join(ROOT, directory, file),
                  path.join(fixture, directory, file),
                );
              }
            }
          }
          fs.writeFileSync(
            path.join(fixture, 'src/main/index.ts'),
            `export const payload = ${JSON.stringify('x'.repeat(bytes))};`,
          );
          fs.writeFileSync(
            path.join(fixture, 'src/main/translation/bergamotWorkerEntry.ts'),
            `export const payload = ${JSON.stringify('x'.repeat(11_000))};`,
          );
        }

        // Existing shard artifacts must remain untouched, even under CI defaults.
        const artifacts = [
          'coverage/sentinel',
          'test-results/junit.xml',
          '.vitest-reports/blob.json',
        ];
        for (const file of artifacts) {
          fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
          fs.writeFileSync(path.join(fixture, file), 'existing shard report');
        }
        const [executable, ...args] = command.split(/\s+/);
        const result = spawnSync(executable, args, {
          cwd: fixture,
          encoding: 'utf8',
          timeout: 60_000,
          env: { ...process.env, CI: 'true', VITEST_MODE: 'related', VITEST_PATHS_JSON: '[]' },
        });
        const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
        expect(result.error, output).toBeUndefined();
        expect(result.status, output).toBe(status);
        if (bytes === null) expect(output).toContain('No test files found');
        else {
          expect(output).toContain('scripts/esbuild-main-build.test.mjs');
          if (status !== 0) {
            expect(output).toContain('keeps the minified main bundle under the size budget');
            expect(output).toContain('749568');
          }
        }
        for (const file of artifacts) {
          expect(fs.readFileSync(path.join(fixture, file), 'utf8')).toBe('existing shard report');
        }
      } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
      }
    },
    90_000,
  );
});
