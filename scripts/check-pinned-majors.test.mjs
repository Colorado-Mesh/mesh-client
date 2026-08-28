// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cappedMajorFromRange,
  evaluateOverrideMajors,
  majorOf,
  parseOverrides,
  PINNED_MAJOR_EXCEPTIONS,
  splitPackageSelector,
} from './check-pinned-majors.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FIXTURE_YAML = `minimumReleaseAge: 540

overrides:
  # A comment inside the block
  '@babel/core': ^7.29.6
  '@meshtastic/core': npm:@jsr/meshtastic__core@^2.6.6
  brace-expansion: 5.0.9
  ip-address: '>=10.3.1'
  markdown-it@<=14.1.1: '>=14.2.0 <15'
  undici@<7.29.0: ^7.29.0
  widget: ^3.1.0
patchedDependencies:
  debug@4.4.3: patches/debug@4.4.3.patch
`;

describe('parseOverrides', () => {
  it('reads quoted keys, selector-scoped keys, aliases, and stops at the next top-level key', () => {
    expect(parseOverrides(FIXTURE_YAML)).toEqual([
      { key: '@babel/core', packageName: '@babel/core', selector: null, range: '^7.29.6' },
      {
        key: '@meshtastic/core',
        packageName: '@jsr/meshtastic__core',
        selector: null,
        range: '^2.6.6',
      },
      { key: 'brace-expansion', packageName: 'brace-expansion', selector: null, range: '5.0.9' },
      { key: 'ip-address', packageName: 'ip-address', selector: null, range: '>=10.3.1' },
      {
        key: 'markdown-it@<=14.1.1',
        packageName: 'markdown-it',
        selector: '<=14.1.1',
        range: '>=14.2.0 <15',
      },
      { key: 'undici@<7.29.0', packageName: 'undici', selector: '<7.29.0', range: '^7.29.0' },
      { key: 'widget', packageName: 'widget', selector: null, range: '^3.1.0' },
    ]);
  });

  it('returns nothing when there is no overrides block', () => {
    expect(parseOverrides('nodeLinker: hoisted\n')).toEqual([]);
  });

  it('parses the real pnpm-workspace.yaml', () => {
    const overrides = parseOverrides(
      fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8'),
    );
    expect(overrides.length).toBeGreaterThan(5);
    const undici = overrides.find((o) => o.packageName === 'undici');
    expect(undici).toMatchObject({ range: '^7.29.0' });
    // patchedDependencies must not leak into the overrides list.
    expect(overrides.some((o) => o.range.includes('.patch'))).toBe(false);
  });
});

describe('splitPackageSelector', () => {
  it('keeps scopes intact and splits on the version selector', () => {
    expect(splitPackageSelector('@babel/core')).toEqual({
      packageName: '@babel/core',
      selector: null,
    });
    expect(splitPackageSelector('markdown-it@<=14.1.1')).toEqual({
      packageName: 'markdown-it',
      selector: '<=14.1.1',
    });
    expect(splitPackageSelector('@jsr/pkg@^1.2.3')).toEqual({
      packageName: '@jsr/pkg',
      selector: '^1.2.3',
    });
  });
});

describe('cappedMajorFromRange', () => {
  it('caps caret, tilde, and exact ranges at their major', () => {
    expect(cappedMajorFromRange('^7.29.0')).toBe(7);
    expect(cappedMajorFromRange('~8.1.0')).toBe(8);
    expect(cappedMajorFromRange('5.0.9')).toBe(5);
  });

  it('uses the upper bound when one is present', () => {
    expect(cappedMajorFromRange('>=14.2.0 <15')).toBe(14);
    expect(cappedMajorFromRange('>=14.2.0 <15.0.0')).toBe(14);
    expect(cappedMajorFromRange('>=15.1.0 <15.2.0')).toBe(15);
  });

  it('treats unbounded ranges as uncapped', () => {
    expect(cappedMajorFromRange('>=10.3.1')).toBeNull();
    expect(cappedMajorFromRange('*')).toBeNull();
    expect(cappedMajorFromRange('')).toBeNull();
  });
});

describe('majorOf', () => {
  it('reads the major from a version string', () => {
    expect(majorOf('8.10.0')).toBe(8);
    expect(majorOf('v41.10.7')).toBe(41);
    expect(majorOf('nonsense')).toBeNull();
  });
});

describe('evaluateOverrideMajors', () => {
  const overrides = [
    { key: 'widget', packageName: 'widget', range: '^3.1.0' },
    { key: 'gadget', packageName: 'gadget', range: '^2.0.0' },
    { key: 'floor-only', packageName: 'floor-only', range: '>=1.2.3' },
  ];

  it('reports an un-excepted stale major as drift', () => {
    const { drifts, excepted } = evaluateOverrideMajors({
      overrides,
      latestByPackage: new Map([
        ['widget', '5.0.0'],
        ['gadget', '2.4.1'],
        ['floor-only', '9.0.0'],
      ]),
      exceptions: {},
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({ packageName: 'widget', cap: 3, latest: '5.0.0' });
    expect(excepted).toEqual([]);
  });

  it('moves a documented cap out of drift and into excepted', () => {
    const { drifts, excepted } = evaluateOverrideMajors({
      overrides,
      latestByPackage: new Map([
        ['widget', '5.0.0'],
        ['gadget', '2.4.1'],
        ['floor-only', '9.0.0'],
      ]),
      exceptions: { widget: 'thing@1 requires ^3' },
    });
    expect(drifts).toEqual([]);
    expect(excepted[0]).toMatchObject({ packageName: 'widget', reason: 'thing@1 requires ^3' });
  });

  it('skips instead of warning when the registry lookup failed', () => {
    const { drifts, skipped } = evaluateOverrideMajors({
      overrides,
      latestByPackage: new Map([
        ['widget', null],
        ['gadget', null],
        ['floor-only', null],
      ]),
      exceptions: {},
    });
    expect(drifts).toEqual([]);
    // `floor-only` is uncapped, so it is never looked at.
    expect(skipped.map((s) => s.packageName)).toEqual(['widget', 'gadget']);
  });

  it('skips unparsable latest versions', () => {
    const { drifts, skipped } = evaluateOverrideMajors({
      overrides: [{ key: 'widget', packageName: 'widget', range: '^3.1.0' }],
      latestByPackage: new Map([['widget', 'not-a-version']]),
      exceptions: {},
    });
    expect(drifts).toEqual([]);
    expect(skipped[0].reason).toMatch(/unparsable/);
  });

  it('keeps the real workspace overrides free of unexplained drift', () => {
    // Every exception entry must still name a package that is actually pinned.
    const pinned = new Set(
      parseOverrides(fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8')).map(
        (o) => o.packageName,
      ),
    );
    for (const packageName of Object.keys(PINNED_MAJOR_EXCEPTIONS)) {
      expect(pinned, `${packageName} is excepted but no longer pinned`).toContain(packageName);
    }
  });
});
