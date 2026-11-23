// @vitest-environment node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { looksExternallyManaged, planYamllintInstall } from './setup-yamllint.mjs';

const SETUP_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'setup-yamllint.mjs'),
  {
    encoding: 'utf8',
  },
);

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

describe('looksExternallyManaged', () => {
  it('detects PEP 668 / externally-managed pip errors', () => {
    expect(looksExternallyManaged('error: externally-managed-environment')).toBe(true);
    expect(looksExternallyManaged('hint: See PEP 668 for details')).toBe(true);
    expect(looksExternallyManaged('Could not find a version that satisfies')).toBe(false);
  });
});

describe('installYamllintViaPip source contract', () => {
  it('falls back to an isolated hashed venv and exposes yamllint on PATH', () => {
    expect(SETUP_SRC).toContain('yamllint-venv');
    expect(SETUP_SRC).toContain("'-m', 'venv'");
    expect(SETUP_SRC).toContain('--require-hashes');
    expect(SETUP_SRC).toContain('--only-binary=:all:');
    expect(SETUP_SRC).toContain('linkYamllintIntoLocalBin');
    expect(SETUP_SRC).toContain('prependPath(binDir)');
  });
});
