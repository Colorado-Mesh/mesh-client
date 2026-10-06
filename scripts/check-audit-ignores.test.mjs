// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluateIgnoredAdvisory,
  lockedVersionsByPackage,
  parseIgnoredGhsas,
  versionInVulnerableRange,
} from './check-audit-ignores.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURE_YAML = `overrides:
  widget: ^3.1.0
auditConfig:
  ignoreGhsas:
    # comment explaining the first ignore
    - GHSA-86w9-cpqp-85rv
# column-zero comment inside the block
    - 'GHSA-aaaa-bbbb-cccc'
    - GHSA-86w9-cpqp-85rv
  ignoreCves:
    - CVE-2026-0001
patchedDependencies:
  debug@4.4.3: patches/debug@4.4.3.patch
`;

describe('parseIgnoredGhsas', () => {
  it('reads the ignoreGhsas list only, deduped, and stops at the next top-level key', () => {
    expect(parseIgnoredGhsas(FIXTURE_YAML)).toEqual(['GHSA-86w9-cpqp-85rv', 'GHSA-aaaa-bbbb-cccc']);
  });

  it('returns nothing without an auditConfig block', () => {
    expect(parseIgnoredGhsas('overrides:\n  widget: ^1.0.0\n')).toEqual([]);
  });

  it('parses the real pnpm-workspace.yaml', () => {
    const yaml = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    const ids = parseIgnoredGhsas(yaml);
    if (/^\s+ignoreGhsas:\s*$/m.test(yaml)) {
      expect(ids.length).toBeGreaterThan(0);
    }
    for (const id of ids) {
      expect(id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i);
    }
  });
});

describe('evaluateIgnoredAdvisory', () => {
  const vuln = (patched) => ({
    package: { ecosystem: 'npm', name: 'node-forge' },
    vulnerable_version_range: '<= 1.4.0',
    first_patched_version: patched,
  });

  it('keeps the ignore while no patched release exists', () => {
    expect(
      evaluateIgnoredAdvisory('GHSA-x', { withdrawn_at: null, vulnerabilities: [vuln(null)] }),
    ).toMatchObject({ status: 'unpatched', packages: ['node-forge (no patch)'] });
  });

  it('flags the ignore as removable once a patched version is published', () => {
    expect(
      evaluateIgnoredAdvisory('GHSA-x', { withdrawn_at: null, vulnerabilities: [vuln('1.4.1')] }),
    ).toMatchObject({ status: 'removable', packages: ['node-forge >=1.4.1'] });
  });

  it('keeps the ignore while any affected npm package is still unpatched', () => {
    const other = {
      package: { ecosystem: 'npm', name: 'node-forge-lite' },
      vulnerable_version_range: '<= 2.0.0',
      first_patched_version: null,
    };
    expect(
      evaluateIgnoredAdvisory('GHSA-x', {
        withdrawn_at: null,
        vulnerabilities: [vuln('1.4.1'), other],
      }),
    ).toMatchObject({ status: 'unpatched' });
  });

  it('skips advisories with no npm vulnerability entries', () => {
    expect(
      evaluateIgnoredAdvisory('GHSA-x', {
        withdrawn_at: null,
        vulnerabilities: [
          {
            package: { ecosystem: 'pip', name: 'forge' },
            vulnerable_version_range: '< 2.0',
            first_patched_version: '2.0',
          },
        ],
      }),
    ).toMatchObject({ status: 'skipped', reason: 'no npm vulnerabilities' });
  });

  it('flags a withdrawn advisory as removable', () => {
    expect(
      evaluateIgnoredAdvisory('GHSA-x', {
        withdrawn_at: '2026-10-05T00:00:00Z',
        vulnerabilities: [vuln(null)],
      }),
    ).toMatchObject({ status: 'removable' });
  });

  it('skips when the lookup failed', () => {
    expect(evaluateIgnoredAdvisory('GHSA-x', null)).toMatchObject({ status: 'skipped' });
  });

  it('flags an ignore as removable when no locked version is in the vulnerable range', () => {
    const locked = new Map([['http-cache-semantics', ['4.3.0']]]);
    expect(
      evaluateIgnoredAdvisory(
        'GHSA-ch52-4w7c-c8xp',
        {
          withdrawn_at: null,
          vulnerabilities: [
            {
              package: { ecosystem: 'npm', name: 'http-cache-semantics' },
              vulnerable_version_range: '<= 4.2.0',
              first_patched_version: null,
            },
          ],
        },
        locked,
      ),
    ).toMatchObject({
      status: 'removable',
      reason: 'no locked version is in the vulnerable range',
    });
  });

  it('keeps the ignore when a locked version is still inside the range', () => {
    const locked = new Map([['node-forge', ['1.4.0']]]);
    expect(
      evaluateIgnoredAdvisory(
        'GHSA-x',
        { withdrawn_at: null, vulnerabilities: [vuln(null)] },
        locked,
      ),
    ).toMatchObject({ status: 'unpatched' });
  });

  it('keeps the ignore when the vulnerable range cannot be parsed', () => {
    const locked = new Map([['node-forge', ['1.4.0']]]);
    expect(
      evaluateIgnoredAdvisory(
        'GHSA-x',
        {
          withdrawn_at: null,
          vulnerabilities: [
            {
              package: { ecosystem: 'npm', name: 'node-forge' },
              vulnerable_version_range: 'not-a-range',
              first_patched_version: null,
            },
          ],
        },
        locked,
      ),
    ).toMatchObject({ status: 'unpatched' });
  });
});

describe('lockedVersionsByPackage', () => {
  it('does not treat a scoped suffix as the unsuffixed package', () => {
    const text = [
      "  '@types/http-cache-semantics@4.2.0':",
      '  http-cache-semantics@4.3.0:',
      '  http-cache-semantics@4.3.0: {}',
      '  foo@1.2.3(bar@9.9.9):',
      '      http-cache-semantics: 4.3.0',
    ].join('\n');
    const map = lockedVersionsByPackage(text);
    expect(map.get('http-cache-semantics')).toEqual(['4.3.0']);
    expect(map.get('@types/http-cache-semantics')).toEqual(['4.2.0']);
    expect(map.get('foo')).toEqual(['1.2.3']);
    expect(map.has('bar')).toBe(false);
  });

  it('sees only http-cache-semantics 4.3.0 in the repo lockfile', () => {
    const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
    expect(lockedVersionsByPackage(lock).get('http-cache-semantics')).toEqual(['4.3.0']);
    expect(versionInVulnerableRange('4.3.0', '<= 4.2.0')).toBe(false);
    expect(versionInVulnerableRange('1.4.0', '<= 1.4.0')).toBe(true);
  });
});
