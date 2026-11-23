// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { planSemgrepInstall } from './setup-semgrep.mjs';

describe('planSemgrepInstall', () => {
  it('short-circuits when semgrep is already installed', () => {
    expect(
      planSemgrepInstall({
        versionOutput: '1.186.0\nextra',
        hasBrew: false,
        hasPipx: false,
        hasPip: false,
      }),
    ).toMatchObject({
      alreadyInstalled: true,
      detail: '1.186.0',
      strategy: 'none',
      note: expect.stringContaining('not required'),
    });
  });

  it('prefers brew on macOS when available', () => {
    expect(
      planSemgrepInstall({
        platform: 'darwin',
        versionOutput: null,
        hasBrew: true,
        hasPipx: true,
        hasPip: true,
      }),
    ).toMatchObject({ alreadyInstalled: false, strategy: 'brew' });
  });

  it('falls back to pipx then pip', () => {
    expect(
      planSemgrepInstall({
        platform: 'linux',
        versionOutput: null,
        hasBrew: false,
        hasPipx: true,
        hasPip: true,
      }).strategy,
    ).toBe('pipx');
    expect(
      planSemgrepInstall({
        platform: 'linux',
        versionOutput: null,
        hasBrew: false,
        hasPipx: false,
        hasPip: true,
      }).strategy,
    ).toBe('pip');
  });

  it('returns none when no installer is available', () => {
    expect(
      planSemgrepInstall({
        platform: 'linux',
        versionOutput: null,
        hasBrew: false,
        hasPipx: false,
        hasPip: false,
      }).strategy,
    ).toBe('none');
  });
});
