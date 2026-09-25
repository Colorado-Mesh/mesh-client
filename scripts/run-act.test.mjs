// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  ACT_CI_JOBS,
  ACT_PLATFORM_IMAGE,
  ACT_PULL_IMAGES,
  ACT_TARGETS,
  buildActArgs,
  buildActBaseArgs,
  parseActMode,
  parseArgv,
  resolveContainerArch,
  resolveContainerEngine,
  resolveDockerSocket,
} from './run-act.mjs';

describe('run-act resolveContainerEngine', () => {
  it('prefers Podman when podman info succeeds', () => {
    const commandOk = (command, args) => command === 'podman' && args[0] === 'info';
    expect(resolveContainerEngine({ commandOk })).toBe('podman');
  });

  it('falls back to Docker when Podman CLI exists but info fails and Docker is ready', () => {
    const commandOk = (command, args) => {
      if (command === 'podman' && args[0] === '--version') return true;
      if (command === 'docker' && args[0] === 'info') return true;
      return false;
    };
    expect(resolveContainerEngine({ commandOk })).toBe('docker');
  });

  it('keeps Podman when neither daemon is ready but Podman CLI exists', () => {
    const commandOk = (command, args) => command === 'podman' && args[0] === '--version';
    expect(resolveContainerEngine({ commandOk })).toBe('podman');
  });

  it('uses Docker when Podman is absent', () => {
    const commandOk = () => false;
    expect(resolveContainerEngine({ commandOk })).toBe('docker');
  });
});

describe('run-act parseActMode', () => {
  it('defaults to docker', () => {
    expect(parseActMode(undefined)).toBe('docker');
    expect(parseActMode('docker')).toBe('docker');
  });

  it('selects native when env is native', () => {
    expect(parseActMode('native')).toBe('native');
  });
});

describe('run-act parseArgv', () => {
  it('parses target and native flag', () => {
    expect(parseArgv(['ci', '--native'], 'docker')).toEqual({
      target: 'ci',
      mode: 'native',
      passthrough: [],
    });
  });

  it('respects env mode unless overridden', () => {
    expect(parseArgv(['tests'], 'native')).toEqual({
      target: 'tests',
      mode: 'native',
      passthrough: [],
    });
    expect(parseArgv(['tests', '--docker'], 'native')).toEqual({
      target: 'tests',
      mode: 'docker',
      passthrough: [],
    });
  });

  it('passes through extra act args after --', () => {
    expect(parseArgv(['ci', '--', '-n'], 'docker')).toEqual({
      target: 'ci',
      mode: 'docker',
      passthrough: ['-n'],
    });
  });
});

describe('run-act resolveDockerSocket', () => {
  it('prefers ACT_DOCKER_SOCKET', () => {
    expect(
      resolveDockerSocket({
        env: { ACT_DOCKER_SOCKET: '/custom/docker.sock' },
        platform: 'darwin',
        homeDir: '/Users/test',
      }),
    ).toBe('/custom/docker.sock');
  });

  it('parses unix DOCKER_HOST', () => {
    expect(
      resolveDockerSocket({
        env: { DOCKER_HOST: 'unix:///Users/test/.docker/run/docker.sock' },
        platform: 'darwin',
        homeDir: '/Users/test',
      }),
    ).toBe('/Users/test/.docker/run/docker.sock');
  });

  it('uses Windows named pipe', () => {
    expect(resolveDockerSocket({ env: {}, platform: 'win32', homeDir: 'C:\\Users\\test' })).toBe(
      '//./pipe/docker_engine',
    );
  });
});

describe('run-act resolveContainerArch', () => {
  it('returns linux/amd64 on arm64 hosts for CI parity', () => {
    expect(resolveContainerArch({ hostArch: 'arm64' })).toBe('linux/amd64');
  });

  it('returns undefined on x64 hosts', () => {
    expect(resolveContainerArch({ hostArch: 'x64' })).toBeUndefined();
  });
});

describe('run-act buildActBaseArgs', () => {
  it('maps ubuntu-latest and docker socket', () => {
    expect(
      buildActBaseArgs({
        hostArch: 'x64',
        dockerSocket: '/var/run/docker.sock',
      }),
    ).toEqual([
      '-P',
      `ubuntu-latest=${ACT_PLATFORM_IMAGE}`,
      '--container-daemon-socket',
      '/var/run/docker.sock',
    ]);
  });

  it('adds container architecture on arm64', () => {
    expect(
      buildActBaseArgs({
        hostArch: 'arm64',
        dockerSocket: '/Users/me/.docker/run/docker.sock',
      }),
    ).toEqual([
      '-P',
      `ubuntu-latest=${ACT_PLATFORM_IMAGE}`,
      '--container-architecture',
      'linux/amd64',
      '--container-daemon-socket',
      '/Users/me/.docker/run/docker.sock',
    ]);
  });

  it('appends passthrough args', () => {
    expect(buildActBaseArgs({ hostArch: 'x64', dockerSocket: null, passthrough: ['-n'] })).toEqual([
      '-P',
      `ubuntu-latest=${ACT_PLATFORM_IMAGE}`,
      '-n',
    ]);
  });
});

describe('run-act ACT_TARGETS.ci', () => {
  const ciWorkflow = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '.github/workflows/ci.yaml'),
    'utf8',
  );

  it('points Docker act:ci at real ci.yaml work jobs, not the Build & Test aggregator', () => {
    expect(ACT_CI_JOBS).toEqual(['quality', 'lint', 'typecheck', 'app-build', 'policy-scanners']);
    expect(ACT_CI_JOBS).not.toContain('build');
    expect(Array.isArray(ACT_TARGETS.ci)).toBe(true);
    if (!Array.isArray(ACT_TARGETS.ci)) {
      throw new Error('expected ACT_TARGETS.ci to be an invocation list');
    }

    const jobs = ACT_TARGETS.ci.map((invocation) => invocation.job);
    expect(jobs).toEqual(ACT_CI_JOBS);

    for (const invocation of ACT_TARGETS.ci) {
      expect(invocation.workflow).toBe('.github/workflows/ci.yaml');
      expect(invocation.event).toBe('workflow_dispatch');
      expect(ciWorkflow).toContain(`  ${invocation.job}:`);
    }

    // Required GitHub check name stays on the aggregator job; act must not target it.
    expect(ciWorkflow).toContain('name: Build & Test');
    expect(ciWorkflow).toMatch(/^ {2}build:/m);
  });

  it('builds act args for each ci work job', () => {
    if (!Array.isArray(ACT_TARGETS.ci)) {
      throw new Error('expected ACT_TARGETS.ci to be an invocation list');
    }
    expect(
      buildActArgs(ACT_TARGETS.ci[0], {
        hostArch: 'x64',
        dockerSocket: '/var/run/docker.sock',
      }),
    ).toEqual([
      '-P',
      `ubuntu-latest=${ACT_PLATFORM_IMAGE}`,
      '--container-daemon-socket',
      '/var/run/docker.sock',
      '-W',
      '.github/workflows/ci.yaml',
      '-j',
      'quality',
      'workflow_dispatch',
    ]);
  });
});

describe('run-act buildActArgs', () => {
  it('builds ci workflow invocation', () => {
    expect(
      buildActArgs(
        {
          event: 'workflow_dispatch',
          workflow: '.github/workflows/ci.yaml',
          job: 'build',
        },
        { hostArch: 'x64', dockerSocket: '/var/run/docker.sock' },
      ),
    ).toEqual([
      '-P',
      `ubuntu-latest=${ACT_PLATFORM_IMAGE}`,
      '--container-daemon-socket',
      '/var/run/docker.sock',
      '-W',
      '.github/workflows/ci.yaml',
      '-j',
      'build',
      'workflow_dispatch',
    ]);
  });

  it('includes privileged container options for flatpak', () => {
    expect(
      buildActArgs(
        {
          event: 'workflow_dispatch',
          workflow: '.github/workflows/flatpak.yaml',
          job: 'flatpak',
          containerOptions: '--privileged',
        },
        { hostArch: 'arm64', dockerSocket: '/var/run/docker.sock' },
      ),
    ).toEqual([
      '-P',
      `ubuntu-latest=${ACT_PLATFORM_IMAGE}`,
      '--container-architecture',
      'linux/amd64',
      '--container-daemon-socket',
      '/var/run/docker.sock',
      '-W',
      '.github/workflows/flatpak.yaml',
      '-j',
      'flatpak',
      '--container-options',
      '--privileged',
      'workflow_dispatch',
    ]);
  });
});

describe('run-act ACT_PULL_IMAGES', () => {
  it('includes platform and flatpak container images', () => {
    expect(ACT_PULL_IMAGES).toHaveLength(2);
    expect(ACT_PULL_IMAGES[0]).toBe(ACT_PLATFORM_IMAGE);
    expect(ACT_PULL_IMAGES[1]).toContain('flatpak-github-actions');
  });
});
