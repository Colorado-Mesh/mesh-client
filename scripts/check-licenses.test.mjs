// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_LICENSE_IDS,
  evaluatePnpmLicensesJson,
  formatLicenseCheckReport,
  isLicenseAllowed,
  splitSpdxTopLevel,
  unwrapSpdxParens,
} from './check-licenses.mjs';

describe('unwrapSpdxParens', () => {
  it('unwraps a single wrapping pair', () => {
    expect(unwrapSpdxParens('(MIT OR Apache-2.0)')).toBe('MIT OR Apache-2.0');
  });

  it('leaves inner parens alone', () => {
    expect(unwrapSpdxParens('(MIT OR (BSD-3-Clause AND ISC))')).toBe(
      'MIT OR (BSD-3-Clause AND ISC)',
    );
  });
});

describe('splitSpdxTopLevel', () => {
  it('splits OR without breaking parenthesized groups', () => {
    expect(splitSpdxTopLevel('MIT OR (BSD-3-Clause AND ISC)', 'OR')).toEqual([
      'MIT',
      '(BSD-3-Clause AND ISC)',
    ]);
  });

  it('splits AND', () => {
    expect(splitSpdxTopLevel('Apache-2.0 AND BSD-3-Clause', 'AND')).toEqual([
      'Apache-2.0',
      'BSD-3-Clause',
    ]);
  });
});

describe('isLicenseAllowed', () => {
  it('allows simple ids from the policy list', () => {
    expect(isLicenseAllowed('MIT')).toBe(true);
    expect(isLicenseAllowed('Hippocratic-2.1')).toBe(true);
    expect(isLicenseAllowed('Hippocratic-3.0')).toBe(true);
    expect(isLicenseAllowed('BlueOak-1.0.0')).toBe(true);
  });

  it('allows lowercase lgpl metadata from the Meshtastic JSR mirror', () => {
    expect(isLicenseAllowed('lgpl')).toBe(true);
    expect(isLicenseAllowed('LGPL-3.0')).toBe(true);
  });

  it('allows OR when any clause is allowed', () => {
    expect(isLicenseAllowed('BSD-3-Clause OR GPL-2.0')).toBe(true);
    expect(isLicenseAllowed('(MIT OR GPL-3.0-or-later)')).toBe(true);
    expect(isLicenseAllowed('MPL-2.0 OR Apache-2.0')).toBe(true);
    expect(isLicenseAllowed('WTFPL OR ISC')).toBe(true);
  });

  it('allows AND only when every clause is allowed', () => {
    expect(isLicenseAllowed('Apache-2.0 AND BSD-3-Clause')).toBe(true);
    expect(isLicenseAllowed('(MIT AND Zlib)')).toBe(true);
    expect(isLicenseAllowed('MIT AND ISC')).toBe(true);
    expect(isLicenseAllowed('MIT AND GPL-3.0')).toBe(false);
  });

  it('rejects unknown, empty, and copyleft-only ids', () => {
    expect(isLicenseAllowed('')).toBe(false);
    expect(isLicenseAllowed('UNKNOWN')).toBe(false);
    expect(isLicenseAllowed('GPL-3.0')).toBe(false);
    expect(isLicenseAllowed('UNLICENSED')).toBe(false);
  });

  it('uses the provided allowlist when passed', () => {
    expect(isLicenseAllowed('MIT', ['Apache-2.0'])).toBe(false);
    expect(isLicenseAllowed('Apache-2.0', ['Apache-2.0'])).toBe(true);
  });
});

describe('evaluatePnpmLicensesJson', () => {
  it('collects violations for disallowed license keys', () => {
    const result = evaluatePnpmLicensesJson({
      MIT: [{ name: 'ok-pkg', versions: ['1.0.0'] }],
      'GPL-3.0': [{ name: 'bad-pkg', versions: ['2.0.0'] }],
    });
    expect(result.packages).toHaveLength(2);
    expect(result.violations).toEqual([
      { license: 'GPL-3.0', name: 'bad-pkg', versions: ['2.0.0'] },
    ]);
    expect(result.counts.get('MIT')).toBe(1);
  });

  it('formats a failing report with package names', () => {
    const report = formatLicenseCheckReport(
      evaluatePnpmLicensesJson({
        MIT: [{ name: 'ok-pkg', versions: ['1.0.0'] }],
        'GPL-3.0': [{ name: 'bad-pkg', versions: ['2.0.0'] }],
      }),
    );
    expect(report).toMatch(/disallowed license/);
    expect(report).toMatch(/GPL-3\.0: bad-pkg@2\.0\.0/);
  });
});

describe('ALLOWED_LICENSE_IDS', () => {
  it('includes Hippocratic 2.1 and 3.0', () => {
    expect(ALLOWED_LICENSE_IDS).toContain('Hippocratic-2.1');
    expect(ALLOWED_LICENSE_IDS).toContain('Hippocratic-3.0');
  });
});
