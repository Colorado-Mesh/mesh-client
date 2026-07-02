// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  formatCheckResult,
  formatLocalActDockerNote,
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
        label: 'pnpm 10+ required',
        detail: 'not found',
        hint: 'corepack enable',
      }),
    ).toEqual(['❌ pnpm 10+ required — not found', '   → corepack enable']);
  });

  it('formats warn results with hints', () => {
    expect(
      formatCheckResult({
        status: 'warn',
        severity: 'optional',
        label: 'Docker not found (optional)',
        hint: 'Install Docker',
      }),
    ).toEqual(['⚠️ Docker not found (optional)', '   → Install Docker']);
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
  it('returns null when neither docker nor act checks are present', () => {
    expect(
      formatLocalActDockerNote([{ status: 'pass', severity: 'required', label: 'Git' }]),
    ).toBeNull();
  });

  it('returns paired missing note when docker or act warns', () => {
    expect(
      formatLocalActDockerNote([
        { status: 'warn', severity: 'optional', label: 'Docker not found (optional)' },
        { status: 'pass', severity: 'optional', label: 'act', detail: '0.2.0' },
      ]),
    ).toContain('act:ci:native');
  });

  it('returns ready note when both docker and act pass', () => {
    expect(
      formatLocalActDockerNote([
        { status: 'pass', severity: 'optional', label: 'Docker', detail: 'Docker 27' },
        { status: 'pass', severity: 'optional', label: 'act', detail: 'act version 0.2.76' },
      ]),
    ).toContain('act:ci:native');
  });

  it('suggests native mode when act is ready but docker is not', () => {
    expect(
      formatLocalActDockerNote([
        {
          status: 'warn',
          severity: 'optional',
          label: 'Docker daemon not running (optional)',
        },
        { status: 'pass', severity: 'optional', label: 'act', detail: 'act version 0.2.76' },
      ]),
    ).toContain('act:ci:native');
  });
});
