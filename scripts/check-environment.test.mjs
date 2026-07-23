// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  formatCheckResult,
  formatLocalActDockerNote,
  evaluateContainerEngineCheck,
  parseVersion,
  resolveExitCode,
  versionGte,
} from './check-environment.mjs';

describe('check-environment parseVersion', () => {
  it('parses v-prefixed semver strings', () => {
    expect(parseVersion('v22.13.0')).toEqual({ major: 22, minor: 13, patch: 0 });
  });

  it('parses plain semver strings', () => {
    expect(parseVersion('18.19.0')).toEqual({ major: 18, minor: 19, patch: 0 });
  });

  it('parses version embedded in command output', () => {
    expect(parseVersion('git version 2.43.0')).toEqual({ major: 2, minor: 43, patch: 0 });
  });

  it('returns null for unparseable strings', () => {
    expect(parseVersion('not-a-version')).toBeNull();
  });
});

describe('check-environment versionGte', () => {
  it('accepts versions at or above the minimum', () => {
    expect(versionGte('v22.13.0', '>=22.13.0')).toBe(true);
    expect(versionGte('22.14.0', '>=22.13.0')).toBe(true);
    expect(versionGte('23.0.0', '>=22.13.0')).toBe(true);
  });

  it('rejects versions below the minimum', () => {
    expect(versionGte('v18.19.0', '>=22.13.0')).toBe(false);
    expect(versionGte('22.12.9', '>=22.13.0')).toBe(false);
  });

  it('compares pnpm-style versions', () => {
    expect(versionGte('10.0.0', '>=10.0.0')).toBe(true);
    expect(versionGte('9.15.0', '>=10.0.0')).toBe(false);
  });
});

describe('check-environment formatCheckResult', () => {
  it('formats pass results without hints', () => {
    expect(
      formatCheckResult({
        status: 'pass',
        severity: 'required',
        label: 'Git',
        detail: '2.43.0',
      }),
    ).toEqual(['✅ Git — 2.43.0']);
  });

  it('formats fail results with hints', () => {
    expect(
      formatCheckResult({
        status: 'fail',
        severity: 'required',
        label: 'pnpm 11+ required',
        detail: 'not found',
        hint: 'corepack enable && corepack prepare pnpm@11 --activate',
      }),
    ).toEqual([
      '❌ pnpm 11+ required — not found',
      '   → corepack enable && corepack prepare pnpm@11 --activate',
    ]);
  });

  it('formats warn results with hints', () => {
    expect(
      formatCheckResult({
        status: 'warn',
        severity: 'optional',
        label: 'Container engine not found (optional)',
        hint: 'Install Docker or Podman',
      }),
    ).toEqual(['⚠️ Container engine not found (optional)', '   → Install Docker or Podman']);
  });
});

describe('check-environment resolveExitCode', () => {
  it('returns 1 when a required check fails', () => {
    expect(
      resolveExitCode([
        { status: 'pass', severity: 'required', label: 'Git' },
        { status: 'fail', severity: 'required', label: 'Node.js' },
      ]),
    ).toBe(1);
  });

  it('returns 0 when only optional checks warn', () => {
    expect(
      resolveExitCode([
        { status: 'pass', severity: 'required', label: 'Git' },
        { status: 'warn', severity: 'optional', label: 'Docker' },
      ]),
    ).toBe(0);
  });

  it('returns 0 when all required checks pass', () => {
    expect(
      resolveExitCode([
        { status: 'pass', severity: 'required', label: 'Git' },
        { status: 'pass', severity: 'required', label: 'Node.js' },
      ]),
    ).toBe(0);
  });
});

describe('check-environment formatLocalActDockerNote', () => {
  it('returns null when neither container engine nor act checks are present', () => {
    expect(
      formatLocalActDockerNote([{ status: 'pass', severity: 'required', label: 'Git' }]),
    ).toBeNull();
  });

  it('returns paired missing note when container engine or act warns', () => {
    expect(
      formatLocalActDockerNote([
        { status: 'warn', severity: 'optional', label: 'Container engine not found (optional)' },
        { status: 'pass', severity: 'optional', label: 'act', detail: '0.2.0' },
      ]),
    ).toContain('act:ci:native');
  });

  it('returns ready note when both container engine and act pass', () => {
    expect(
      formatLocalActDockerNote([
        { status: 'pass', severity: 'optional', label: 'Container engine', detail: 'Podman 5.8.5' },
        { status: 'pass', severity: 'optional', label: 'act', detail: 'act version 0.2.76' },
      ]),
    ).toContain('act:ci:native');
  });

  it('suggests native mode when act is ready but container engine is not', () => {
    expect(
      formatLocalActDockerNote([
        {
          status: 'warn',
          severity: 'optional',
          label: 'Container engine not running (optional)',
        },
        { status: 'pass', severity: 'optional', label: 'act', detail: 'act version 0.2.76' },
      ]),
    ).toContain('act:ci:native');
  });
});

describe('check-environment evaluateContainerEngineCheck', () => {
  it('prefers Podman when both engines are ready', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: '/opt/podman/bin/podman',
      dockerOk: true,
      podmanOk: true,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: 'podman version 5.8.5',
      socket: '/var/run/docker.sock',
    });
    expect(result).toMatchObject({
      status: 'pass',
      label: 'Container engine',
    });
    expect(result.detail).toContain('podman version 5.8.5');
    expect(result.detail).toContain('/var/run/docker.sock');
    expect(result.detail).not.toContain('Docker version');
  });

  it('falls back to Docker when only Docker is ready', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: null,
      dockerOk: true,
      podmanOk: false,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: null,
      socket: '/Users/test/.docker/run/docker.sock',
    });
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Docker version 28.0.0');
  });

  it('reports not running when a CLI is present but info fails', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: null,
      dockerOk: false,
      podmanOk: false,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: null,
    });
    expect(result).toMatchObject({
      status: 'warn',
      label: 'Container engine not running (optional)',
      detail: 'Docker version 28.0.0',
    });
    expect(result.hint).toContain('Podman Desktop');
  });

  it('prefers Podman detail when both CLIs are present but neither info succeeds', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: '/opt/podman/bin/podman',
      dockerOk: false,
      podmanOk: false,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: 'podman version 5.8.5',
    });
    expect(result.label).toBe('Container engine not running (optional)');
    expect(result.detail).toBe('podman version 5.8.5');
  });

  it('reports not found when no CLI is on PATH', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: null,
      podmanPath: null,
      dockerOk: false,
      podmanOk: false,
      dockerVersion: null,
      podmanVersion: null,
      hasPodmanApp: true,
    });
    expect(result).toMatchObject({
      status: 'warn',
      label: 'Container engine not found (optional)',
    });
    expect(result.hint).toContain('/opt/podman/bin');
  });
});
