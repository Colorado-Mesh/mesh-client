// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = load(fs.readFileSync(path.join(root, '.github/workflows/codeql.yaml'), 'utf8'));
const job = workflow.jobs.analyze;
const build = job.steps.find((step) => step.name === 'Build Swift helper');

/** Exercise the actual workflow shell with fake compiler/SDK boundaries. */
function runBuild(arch, failure = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-codeql-build-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'xcrun'),
      `#!/bin/sh
if [ "$1" = '--show-sdk-path' ]; then
  [ "$CI_CODEQL_TEST_FAILURE" != sdk ] || exit 17
  printf '%s\\n' '/SDK with spaces'
else
  printf '%s\\n' "$@" >> "$CI_CODEQL_TEST_ARGS"
  [ "$CI_CODEQL_TEST_FAILURE" != compile ] || exit 19
fi
`,
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(bin, 'uname'), `#!/bin/sh\nprintf '%s\\n' '${arch}'\n`, {
      mode: 0o755,
    });
    const argsFile = path.join(dir, 'args');
    const result = spawnSync('bash', ['-c', build.run], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        RUNNER_TEMP: dir,
        CI_CODEQL_TEST_ARGS: argsFile,
        CI_CODEQL_TEST_FAILURE: failure,
      },
      encoding: 'utf8',
    });
    return {
      status: result.status,
      args: fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim().split('\n') : [],
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('CodeQL advanced workflow', () => {
  it('retains all six languages and uses manual compilation only for Swift', () => {
    expect(job.strategy['fail-fast']).toBe(false);
    expect(job.strategy.matrix.include).toEqual([
      { language: 'actions', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'csharp', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'javascript-typescript', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'python', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'rust', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'swift', os: 'macos-latest', 'build-mode': 'manual' },
    ]);
    expect(build.if).toBe("matrix.language == 'swift'");
    const init = job.steps.find((step) => step.name === 'Initialize CodeQL');
    expect(init.with.queries).toBe('security-extended');
    expect(init.with['build-mode']).toBe('${{ matrix.build-mode }}');
    expect(init.with['dependency-caching']).toBe(true);
    expect(load(init.with.config)).toEqual({ 'threat-models': ['remote'] });
    expect(init.with['config-file']).toBeUndefined();
    expect(job.steps.some((step) => step.uses?.includes('/autobuild@'))).toBe(false);
  });

  it('validates PRs and dispatches without uploading until the explicit migration switch', () => {
    expect(job.if).toBe(
      "github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch' || " +
        "vars.CODEQL_ADVANCED_ENABLED == 'true'",
    );
    const analyze = job.steps.find((step) => step.name === 'Perform CodeQL Analysis');
    expect(analyze.with.upload).toBe(
      "${{ vars.CODEQL_ADVANCED_ENABLED == 'true' && 'always' || 'never' }}",
    );
    expect(analyze.with.category).toBe('/language:${{ matrix.language }}');
    expect(job.permissions).toEqual({ contents: 'read', 'security-events': 'write' });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(job.steps[0].with['persist-credentials']).toBe(false);
    expect(job.steps.map((step) => step.name).filter(Boolean)).toEqual([
      'Initialize CodeQL',
      'Build Swift helper',
      'Perform CodeQL Analysis',
      'Upload analysis results',
    ]);
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
    expect(artifact.if).toBe('always()');
    expect(artifact.with.name).toBe('codeql-sarif-${{ matrix.language }}');
    expect(artifact.with.path).toBe('${{ runner.temp }}/codeql-results');
    expect(artifact.with['retention-days']).toBe(7);
  });

  it.each(['arm64', 'x86_64'])('compiles the production source exactly once on %s', (arch) => {
    const result = runBuild(arch);
    expect(result.status).toBe(0);
    expect(result.args.slice(0, 7)).toEqual([
      'swiftc',
      '-parse-as-library',
      '-Onone',
      '-sdk',
      '/SDK with spaces',
      '-target',
      `${arch}-apple-macosx26.0`,
    ]);
    expect(result.args[7]).toBe('-module-cache-path');
    expect(result.args[8]).toMatch(/mesh-codeql-swift\.[^/]+\/module-cache$/);
    expect(result.args.slice(9, 11)).toEqual(['native/ai/apple/main.swift', '-o']);
    expect(result.args[11]).toMatch(/mesh-codeql-swift\.[^/]+\/mesh-ai$/);
    expect(result.args).toHaveLength(12);
  });

  it.each([
    ['sdk', 17],
    ['compile', 19],
  ])('fails the step when %s fails', (failure, status) => {
    expect(runBuild('arm64', failure).status).toBe(status);
  });
});
