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
  it('restores target-specific dependencies without skipping fresh builds or tests', () => {
    const workflow = yaml.load(sidecars);
    const steps = workflow.jobs.build.steps;
    const cache = steps.findIndex((step) => step.uses?.startsWith('Swatinem/rust-cache@'));
    const toolchain = steps.findIndex((step) => step.uses?.startsWith('dtolnay/rust-toolchain@'));
    const build = steps.findIndex((step) => step.name === 'Build and stage sidecar');
    expect(toolchain).toBeGreaterThanOrEqual(0);
    expect(cache).toBeGreaterThan(toolchain);
    expect(build).toBeGreaterThan(cache);
    expect(steps[cache].with).toMatchObject({
      workspaces: 'reticulum-sidecar -> target',
      key: 'packaging-${{ matrix.target }}',
      'cache-bin': false,
      'cache-workspace-crates': false,
    });
    expect(steps[cache].with['shared-key']).toBeUndefined();
    expect(steps[cache].with['cache-on-failure']).toBeUndefined();
    expect(steps[build].if).toBeUndefined();
    expect(steps[build].run).toContain('node scripts/build-reticulum-sidecar-release.mjs');
    expect(steps[build].run).toContain("${{ !matrix.run_tests && '--skip-tests' || '' }}");
    expect(steps[build].env.WORKSPACE_ROOT).toBe('${{ github.workspace }}/.rsstack');
  });

  it('allows isolated sidecar builds with the same platform input as reusable packaging', () => {
    const workflow = yaml.load(sidecars);
    expect(workflow.on.workflow_dispatch.inputs.platforms.options).toEqual([
      'all',
      'mac',
      'linux',
      'win',
    ]);
    expect(workflow.on.workflow_dispatch.inputs.platforms.default).toBe(
      workflow.on.workflow_call.inputs.platforms.default,
    );
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it.each(['build', 'release'])('blocks %s packaging until the sidecars succeed', (file) => {
    const workflow = read(`.github/workflows/${file}.yaml`);
    const job = workflow.split(`\n  ${file}:\n`)[1].split(/\n {2}[\w-]+:\n/)[0];
    expect(workflow).toContain('uses: ./.github/workflows/packaging-sidecars.yaml');
    // Stay inside the needs list. [\s\S] would match past its closing bracket.
    expect(job).toMatch(/needs:\s*\[[^\]]*sidecars[^\]]*\]/);
    expect('needs: [other]\n  sidecars:').not.toMatch(/needs:\s*\[[^\]]*sidecars[^\]]*\]/);
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

  it('builds every release platform from the same protected tag commit', () => {
    const release = read('.github/workflows/release.yaml');
    const job = release.split('\n  sidecars:\n')[1].split('\n  release:\n')[0];
    expect(job).toContain('platforms: all');
    expect(release).not.toContain('workflow_dispatch');
    expect(sidecars).toContain('RELEASE_PLATFORMS: ${{ inputs.platforms }}');
    expect(sidecars).toContain('node scripts/resolve-release-matrix.mjs --sidecars');
    expect(sidecars.match(/ref: \$\{\{ github.sha \}\}/g)).toHaveLength(2);
    expect(sidecars).toContain('targets: ${{ matrix.target }}');
    expect(sidecars).toContain('--platform ${{ matrix.platform }} --arch ${{ matrix.arch }}');
    expect(sidecars).toContain("${{ !matrix.run_tests && '--skip-tests' || '' }}");
    expect(sidecars).toContain('Smoke-test staged sidecar HTTP');
    expect(sidecars).toContain('node scripts/smoke-reticulum-sidecar-http.mjs');
    expect(sidecars).toContain('Assert Linux sidecar glibc floor');
    expect(sidecars).toContain('node scripts/check-reticulum-sidecar-glibc.mjs');
    expect(sidecars).toContain('Setup Zig');
    expect(sidecars).toContain('mlugg/setup-zig@');
    expect(sidecars).toContain('version: 0.15.1');
    expect(sidecars).not.toContain('version: latest');
    expect(sidecars).toContain('Install cargo-zigbuild');
    expect(sidecars).toContain('cargo install cargo-zigbuild --version 0.24.1 --locked');
    expect(sidecars).toContain('docs/ci-cd.md#linux-sidecar-glibc');
    expect(sidecars).not.toMatch(/continue-on-error:/);
    const smoke = yaml
      .load(sidecars)
      .jobs.build.steps.find((step) => step.name === 'Smoke-test staged sidecar HTTP');
    expect(smoke?.shell).toBe('bash');
  });

  it('keeps Zig + cargo-zigbuild before the Linux release build', () => {
    const workflow = yaml.load(sidecars);
    const steps = workflow.jobs.build.steps;
    const zig = steps.findIndex((step) => step.name === 'Setup Zig');
    const zigbuild = steps.findIndex((step) => step.name === 'Install cargo-zigbuild');
    const build = steps.findIndex((step) => step.name === 'Build and stage sidecar');
    expect(zig).toBeGreaterThanOrEqual(0);
    expect(zigbuild).toBeGreaterThan(zig);
    expect(build).toBeGreaterThan(zigbuild);
    expect(steps[zig].if).toBe("matrix.platform == 'linux'");
    expect(steps[zigbuild].if).toBe("matrix.platform == 'linux'");
  });

  it('runs staged sidecar HTTP smoke under bash so Windows expands env vars', () => {
    const workflow = yaml.load(sidecars);
    const smoke = workflow.jobs.build.steps.find(
      (step) => step.name === 'Smoke-test staged sidecar HTTP',
    );
    expect(smoke).toBeDefined();
    expect(smoke.shell).toBe('bash');
    expect(smoke.if).toBe('matrix.run_tests');
    expect(smoke.run).toContain('smoke-reticulum-sidecar-http.mjs');
  });

  it('downloads only this run’s staged Reticulum binaries and requires both architectures', () => {
    expect(download).toContain('pattern: ci-reticulum-staged-${{ inputs.platform }}-*');
    expect(download).toContain('merge-multiple: true');
    expect(download).not.toMatch(/run-id:|github-token:|repository:|continue-on-error:/);
    expect(download).toContain(
      'node scripts/verify-reticulum-sidecar-staged.mjs --platform "$SIDECAR_PLATFORM"',
    );
    expect(sidecars).toContain('if-no-files-found: error');
    expect(sidecars).toContain('name: Stage Reticulum ${{ matrix.platform }} ${{ matrix.arch }}');
    expect(sidecars).toContain(
      'name: ci-reticulum-staged-${{ matrix.platform }}-${{ matrix.arch }}',
    );
  });

  it('prefixes Build Binaries installer artifacts with test- and keeps Release unprefixed', () => {
    const build = read('.github/workflows/build.yaml');
    const release = read('.github/workflows/release.yaml');
    // macOS/Linux still use a single test-prefixed zip artifact.
    for (const os of ['macos', 'linux']) {
      expect(build).toContain(`name: test-mesh-client-${os}-\${{ github.sha }}`);
      expect(build).toContain(`artifact: test-mesh-client-${os}-\${{ github.sha }}`);
    }
    // Windows Build Binaries: archive:false Setup .exe (basename artifact) + test-prefixed meta zip.
    expect(build).toContain('name: test-mesh-client-windows-meta-${{ github.sha }}');
    expect(build).toContain('archive: false');
    expect(build).toContain('artifact_mode: windows-split');
    expect(build).toContain('pattern: Mesh-client-Setup-*');
    expect(build).not.toContain('name: test-mesh-client-windows-${{ github.sha }}');
    expect(build).not.toContain('artifact: test-mesh-client-windows-${{ github.sha }}');
    for (const os of ['macos', 'linux']) {
      expect(release).toContain(`name: mesh-client-${os}-\${{ github.sha }}`);
      expect(release).toContain(`artifact: mesh-client-${os}-\${{ github.sha }}`);
      expect(release).not.toContain(`test-mesh-client-${os}-`);
    }
    expect(release).toContain('name: mesh-client-windows-meta-${{ github.sha }}');
    expect(release).toContain('archive: false');
    expect(release).toContain('artifact_mode: windows-split');
    expect(release).toContain('pattern: Mesh-client-Setup-*');
    expect(release).not.toContain('name: mesh-client-windows-${{ github.sha }}');
    expect(release).not.toContain('artifact: mesh-client-windows-${{ github.sha }}');
    expect(build).toContain('name: Stage Reticulum');
    expect(release).toContain('name: Stage Reticulum');
    expect(build).toContain('name: Package ${{ matrix.sidecar_platform }}');
  });
});

const fixtures = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-sidecar-archive-'));
  fixtures.push(root);
  for (const dir of ['scripts', 'scripts/lib', '.rsstack', '.sidecar-artifacts']) {
    mkdirSync(path.join(root, dir));
  }
  for (const file of [
    'verify-reticulum-sidecar-staged.mjs',
    'reticulum-sidecar-staging.mjs',
    'resolve-release-matrix.mjs',
    'check-reticulum-sidecar-glibc.mjs',
    'binary-arch.mjs',
  ]) {
    copyFileSync(new URL(file, import.meta.url), path.join(root, 'scripts', file));
  }
  copyFileSync(
    new URL('./lib/path-under-root.mjs', import.meta.url),
    path.join(root, 'scripts/lib/path-under-root.mjs'),
  );
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
        expect(
          readFileSync(binary).equals(Buffer.alloc(1024 * 1024, arch === 'x64' ? 33 : 77)),
        ).toBe(true);
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
