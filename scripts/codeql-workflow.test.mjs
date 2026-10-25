// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = load(fs.readFileSync(path.join(root, '.github/workflows/codeql.yaml'), 'utf8'));
const job = workflow.jobs.analyze;
const scope = workflow.jobs.scope;
const filter = scope.steps[0];
const filters = load(filter.with.filters);
const swiftInputs = filters.swift;
const selected = "matrix.language != 'swift' || needs.scope.outputs.swift == 'true'";

/** Small, portable glob syntax shared by the workflow filter and Node's matcher. */
function selectsSwift(file) {
  return swiftInputs.some((pattern) => path.matchesGlob(file, pattern));
}

describe('CodeQL advanced workflow', () => {
  it('retains all six languages, extended queries and the existing Swift autobuild', () => {
    expect(job.strategy['fail-fast']).toBe(false);
    expect(job.strategy.matrix.include).toEqual([
      { language: 'actions', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'csharp', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'javascript-typescript', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'python', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'rust', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'swift', os: 'macos-latest', 'build-mode': 'autobuild' },
    ]);
    const init = job.steps.find((step) => step.name === 'Initialize CodeQL');
    expect(init.with.queries).toBe('security-extended');
    expect(init.with['build-mode']).toBe('${{ matrix.build-mode }}');
    expect(init.with['dependency-caching']).toBe(true);
    expect(load(init.with.config)).toEqual({ 'threat-models': ['remote'] });
    expect(init.with['config-file']).toBeUndefined();
    const build = job.steps.find((step) => step.name === 'Build Swift helper');
    expect(build.if).toBe("matrix.language == 'swift' && needs.scope.outputs.swift == 'true'");
    expect(build.uses).toMatch(/^github\/codeql-action\/autobuild@[a-f0-9]{40}$/);
    expect(job.steps.filter((step) => step.uses?.includes('/autobuild@'))).toHaveLength(1);
  });

  it('limits only unchanged PR Swift inputs and fails closed on detector errors', () => {
    expect(job.needs).toBe('scope');
    expect(scope.outputs.swift).toBe(
      "${{ github.event_name != 'pull_request' || steps.filter.outcome != 'success' || " +
        "steps.filter.outputs.all_count == '' || steps.filter.outputs.all_count >= 3000 || " +
        "steps.filter.outputs.swift != 'false' }}",
    );
    expect(filter.if).toBe("github.event_name == 'pull_request'");
    expect(filter['continue-on-error']).toBe(true);
    expect(filter.uses).toMatch(/^dorny\/paths-filter@[a-f0-9]{40}$/);
    expect(scope.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
    expect(scope.steps).toHaveLength(1);
    expect(filters.all).toEqual(['**']);
    for (const file of ['README.md', 'native/ai/apple/main.swift']) {
      expect(path.matchesGlob(file, filters.all[0])).toBe(true);
    }
    for (const step of job.steps.filter(
      (step) =>
        step.uses && !step.uses.includes('/autobuild@') && !step.uses.includes('upload-artifact@'),
    )) {
      expect(step.if).toBe(selected);
    }
    expect(job.steps.find((step) => step.name === 'Record unchanged Swift inputs').if).toBe(
      "matrix.language == 'swift' && needs.scope.outputs.swift != 'true'",
    );
  });

  it.each([
    'Package.swift',
    'native/ai/apple/main.swift',
    'native/ai/apple/deleted.swift',
    'native/ai/apple/future/new.swift',
    'other/new.swift',
    'native/ai/apple/Package.resolved',
    'scripts/build-ai-helper.mjs',
    'scripts/codeql-workflow.test.mjs',
    '.github/workflows/codeql.yaml',
    '.github/codeql/codeql-config.yml',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ])('scans Swift when its source, build or analysis input changes: %s', (file) => {
    expect(selectsSwift(file)).toBe(true);
  });

  it.each(['README.md', 'docs/ci-cd.md', 'src/renderer/App.tsx', 'src/main/database.ts'])(
    'avoids a redundant Swift PR build for %s',
    (file) => {
      expect(selectsSwift(file)).toBe(false);
    },
  );

  it('validates PRs and dispatches without uploading until the explicit migration switch', () => {
    const enabled =
      "github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch' || " +
      "vars.CODEQL_ADVANCED_ENABLED == 'true'";
    expect(job.if).toBe(enabled);
    expect(scope.if).toBe(enabled);
    const analyze = job.steps.find((step) => step.name === 'Perform CodeQL Analysis');
    expect(analyze.with.upload).toBe(
      "${{ vars.CODEQL_ADVANCED_ENABLED == 'true' && 'always' || 'never' }}",
    );
    expect(analyze.with.category).toBe('/language:${{ matrix.language }}');
    expect(job.permissions).toEqual({ contents: 'read', 'security-events': 'write' });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.steps[0].with['persist-credentials']).toBe(false);
  });

  it('scans protected events and retains independent per-language SARIF artifacts', () => {
    expect(workflow.on).toEqual({
      push: { branches: ['main'] },
      pull_request: { branches: ['main'] },
      merge_group: null,
      schedule: [{ cron: '23 7 * * 1' }],
      workflow_dispatch: null,
    });
    expect(workflow.concurrency['cancel-in-progress']).toBe(true);
    expect(workflow.concurrency.group).toContain('github.event.pull_request.number || github.ref');
    const artifact = job.steps.find((step) => step.name === 'Upload analysis results');
    expect(artifact.if).toBe(`always() && (${selected})`);
    expect(artifact.with.name).toBe('codeql-sarif-${{ matrix.language }}');
    expect(artifact.with.path).toBe('${{ runner.temp }}/codeql-results');
    expect(artifact.with['retention-days']).toBe(7);
  });
});
