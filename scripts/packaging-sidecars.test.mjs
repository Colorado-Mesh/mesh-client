// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { stagedSidecarPath } from './reticulum-sidecar-staging.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const sidecars = read('.github/workflows/packaging-sidecars.yaml');
const download = read('.github/actions/download-packaging-sidecars/action.yaml');

function runBlock(source, step) {
  const workflow = yaml.load(source);
  const steps =
    workflow.runs?.steps ?? Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
  const run = steps.find(({ name }) => name === step)?.run;
  expect(run, step).toBeTypeOf('string');
  return run;
}

describe('packaging sidecar workflow gates', () => {
  it.each(['build', 'release'])('blocks %s packaging until the sidecars succeed', (file) => {
    const workflow = read(`.github/workflows/${file}.yaml`);
    const job = workflow.split(`\n  ${file}:\n`)[1].split(/\n {2}[\w-]+:\n/)[0];
    expect(workflow).toContain('uses: ./.github/workflows/packaging-sidecars.yaml');
    expect(job).toMatch(/needs: \[[^\]]*sidecars\]/);
    if (file === 'release') expect(job).toContain("needs.sidecars.result == 'success'");
    expect(job).toContain('uses: ./.github/actions/download-packaging-sidecars');
    expect(job).toContain('platform: ${{ matrix.sidecar_platform }}');
    expect(job).not.toMatch(/build-reticulum-sidecar-release|continue-on-error:/);
    for (const smoke of [
      'macOS packaging',
      'Linux packaging',
      'x64 NSIS install',
      'arm64 NSIS install (WoA)',
    ]) {
      expect(workflow).toContain(`label: ${smoke}`);
    }
  });

  it('keeps release platform filtering and same-commit sidecar builds', () => {
    const release = read('.github/workflows/release.yaml');
    const job = release.split('\n  sidecars:\n')[1].split('\n  release:\n')[0];
    expect(job).toContain(
      "platforms: ${{ github.event_name == 'workflow_dispatch' && inputs.platforms || 'all' }}",
    );
    expect(sidecars).toContain('RELEASE_PLATFORMS: ${{ inputs.platforms }}');
    expect(sidecars).toContain('node scripts/resolve-release-matrix.mjs --sidecars');
    expect(sidecars.match(/ref: \$\{\{ github.sha \}\}/g)).toHaveLength(2);
    expect(sidecars).toContain('targets: ${{ matrix.target }}');
    expect(sidecars).toContain('--platform ${{ matrix.platform }} --arch ${{ matrix.arch }}');
    expect(sidecars).toContain("${{ !matrix.run_tests && '--skip-tests' || '' }}");
    expect(sidecars).not.toMatch(/continue-on-error:/);
  });

  it('downloads only this run’s sidecars and requires both staged architectures', () => {
    expect(download).toContain('pattern: packaging-sidecar-${{ inputs.platform }}-*');
    expect(download).toContain('merge-multiple: true');
    expect(download).not.toMatch(/run-id:|github-token:|repository:|continue-on-error:/);
    expect(download).toContain(
      'node scripts/verify-reticulum-sidecar-staged.mjs --platform "$SIDECAR_PLATFORM"',
    );
    expect(sidecars).toContain('if-no-files-found: error');
  });
});

const fixtures = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-sidecar-archive-'));
  fixtures.push(root);
  for (const dir of ['scripts', '.rsstack', '.sidecar-artifacts']) mkdirSync(path.join(root, dir));
  for (const file of [
    'verify-reticulum-sidecar-staged.mjs',
    'reticulum-sidecar-staging.mjs',
    'resolve-release-matrix.mjs',
  ]) {
    copyFileSync(new URL(file, import.meta.url), path.join(root, 'scripts', file));
  }
  writeFileSync(path.join(root, '.rsstack/RESOLVED_SHAS.txt'), 'rsNomad abc123\n');
  return root;
}

function bash(root, source, env = {}) {
  return spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', source], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function verify(root, platform) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts/verify-reticulum-sidecar-staged.mjs'), '--platform', platform],
    { encoding: 'utf8' },
  );
}

const matrixSteps = [
  { workflow: 'packaging-sidecars', step: 'Resolve sidecar matrix', rows: 4 },
  { workflow: 'release', step: 'Resolve release matrix', rows: 2 },
];

describe.skipIf(process.platform === 'win32')('matrix resolver shell steps', () => {
  it.each(matrixSteps)('publishes the selected $workflow matrix', ({ workflow, step, rows }) => {
    const root = fixture();
    const output = path.join(root, 'github-output');
    const result = bash(root, runBlock(read(`.github/workflows/${workflow}.yaml`), step), {
      RELEASE_PLATFORMS: 'linux,win',
      GITHUB_OUTPUT: output,
    });
    expect(result.status, result.stderr).toBe(0);
    const value = readFileSync(output, 'utf8').trim();
    expect(value.startsWith('include=')).toBe(true);
    expect(JSON.parse(value.slice('include='.length))).toHaveLength(rows);
  });

  it.each(matrixSteps)('preserves invalid input failures in $workflow', ({ workflow, step }) => {
    const root = fixture();
    const output = path.join(root, 'github-output');
    const result = bash(root, runBlock(read(`.github/workflows/${workflow}.yaml`), step), {
      RELEASE_PLATFORMS: 'unknown',
      GITHUB_OUTPUT: output,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('No release platforms matched input: unknown');
    expect(existsSync(output)).toBe(false);
  });
});

// The archive harness uses POSIX bash; real Windows packaging is covered by CI smoke jobs.
describe.skipIf(process.platform === 'win32')('staged sidecar archive handoff', () => {
  it.each(['win32', 'linux', 'darwin'])(
    'restores both %s architectures and source revisions',
    (platform) => {
      const root = fixture();
      for (const arch of ['x64', 'arm64']) {
        const binary = stagedSidecarPath(root, platform, arch);
        mkdirSync(path.dirname(binary), { recursive: true });
        writeFileSync(binary, Buffer.alloc(1024 * 1024, arch === 'x64' ? 33 : 77));
        chmodSync(binary, 0o755);
        const result = bash(root, runBlock(sidecars, 'Archive sidecar and source revisions'), {
          SIDECAR: `${platform}-${arch}`,
        });
        expect(result.status, result.stderr).toBe(0);
        const name = `sidecar-${platform}-${arch}.tar`;
        copyFileSync(path.join(root, name), path.join(root, '.sidecar-artifacts', name));
      }
      rmSync(path.join(root, 'resources'), { recursive: true });
      const restored = bash(root, runBlock(download, 'Restore staged sidecars'));
      expect(restored.status, restored.stderr).toBe(0);
      const checked = verify(root, platform);
      expect(checked.status, checked.stderr).toBe(0);
      for (const arch of ['x64', 'arm64']) {
        const binary = stagedSidecarPath(root, platform, arch);
        expect(readFileSync(binary)).toEqual(Buffer.alloc(1024 * 1024, arch === 'x64' ? 33 : 77));
        expect(statSync(binary).mode & 0o111).toBe(0o111);
        expect(readFileSync(path.join(path.dirname(binary), 'RESOLVED_SHAS.txt'), 'utf8')).toBe(
          'rsNomad abc123\n',
        );
      }
      rmSync(stagedSidecarPath(root, platform, 'arm64'));
      expect(verify(root, platform).status).not.toBe(0);
    },
  );

  it('fails extraction when no sidecar artifacts were downloaded', () => {
    const result = bash(fixture(), runBlock(download, 'Restore staged sidecars'));
    expect(result.status).not.toBe(0);
  });
});
