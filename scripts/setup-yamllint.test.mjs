// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { planYamllintInstall } from './setup-yamllint.mjs';

describe('planYamllintInstall', () => {
  it('short-circuits when yamllint is already installed', () => {
    expect(
      planYamllintInstall({
        versionOutput: 'yamllint 1.37.1',
        hasBrew: false,
        hasApt: false,
        hasPip: false,
      }),
    ).toMatchObject({
      alreadyInstalled: true,
      detail: 'yamllint 1.37.1',
      strategy: 'none',
    });
  });

  it('prefers brew on macOS, apt on Linux, then pip', () => {
    expect(
      planYamllintInstall({
        platform: 'darwin',
        versionOutput: null,
        hasBrew: true,
        hasApt: true,
        hasPip: true,
      }).strategy,
    ).toBe('brew');
    expect(
      planYamllintInstall({
        platform: 'linux',
        versionOutput: null,
        hasBrew: false,
        hasApt: true,
        hasPip: true,
      }).strategy,
    ).toBe('apt');
    expect(
      planYamllintInstall({
        platform: 'linux',
        versionOutput: null,
        hasBrew: false,
        hasApt: false,
        hasPip: true,
      }).strategy,
    ).toBe('pip');
  });

  it('returns none when no installer is available', () => {
    expect(
      planYamllintInstall({
        platform: 'win32',
        versionOutput: null,
        hasBrew: false,
        hasApt: false,
        hasPip: false,
      }).strategy,
    ).toBe('none');
  });
});
