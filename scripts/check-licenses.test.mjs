// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_LICENSE_IDS,
  enrichPnpmLicensesJson,
  evaluatePnpmLicensesJson,
  formatLicenseCheckReport,
  isLicenseAllowed,
  licenseFromPackageManifest,
  parseSeeLicenseInFilename,
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

  it('allows GPL-3.0 family ids used by Meshtastic and the app SPDX', () => {
    expect(isLicenseAllowed('GPL-3.0')).toBe(true);
    expect(isLicenseAllowed('GPL-3.0-only')).toBe(true);
    expect(isLicenseAllowed('GPL-3.0-or-later')).toBe(true);
    expect(ALLOWED_LICENSE_IDS).toEqual(
      expect.arrayContaining(['GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later']),
    );
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
    expect(isLicenseAllowed('MIT AND GPL-3.0')).toBe(true);
    expect(isLicenseAllowed('MIT AND GPL-2.0')).toBe(false);
  });

  it('rejects unknown, empty, and disallowed ids', () => {
    expect(isLicenseAllowed('')).toBe(false);
    expect(isLicenseAllowed('UNKNOWN')).toBe(false);
    expect(isLicenseAllowed('GPL-2.0')).toBe(false);
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
      'GPL-2.0': [{ name: 'bad-pkg', versions: ['2.0.0'] }],
    });
    expect(result.packages).toHaveLength(2);
    expect(result.violations).toEqual([
      { license: 'GPL-2.0', name: 'bad-pkg', versions: ['2.0.0'] },
    ]);
    expect(result.counts.get('MIT')).toBe(1);
  });

  it('formats a failing report with package names', () => {
    const report = formatLicenseCheckReport(
      evaluatePnpmLicensesJson({
        MIT: [{ name: 'ok-pkg', versions: ['1.0.0'] }],
        'GPL-2.0': [{ name: 'bad-pkg', versions: ['2.0.0'] }],
      }),
    );
    expect(report).toMatch(/disallowed license/);
    expect(report).toMatch(/GPL-2\.0: bad-pkg@2\.0\.0/);
  });

  it('throws when a license group is not an array', () => {
    expect(() => evaluatePnpmLicensesJson({ MIT: 'not-an-array' })).toThrow(/expected array/);
  });

  it('throws when a license entry is null or not an object', () => {
    expect(() => evaluatePnpmLicensesJson({ MIT: [null] })).toThrow(/expected package object/);
    expect(() => evaluatePnpmLicensesJson({ MIT: ['bad'] })).toThrow(/expected package object/);
  });
});

describe('parseSeeLicenseInFilename', () => {
  it('accepts basename-only declarations', () => {
    expect(parseSeeLicenseInFilename('SEE LICENSE IN COPYING')).toBe('COPYING');
    expect(parseSeeLicenseInFilename('SEE LICENSE IN LICENSE')).toBe('LICENSE');
    expect(parseSeeLicenseInFilename('SEE LICENSE IN X')).toBe('X');
  });

  it('rejects path separators and parent traversal', () => {
    expect(parseSeeLicenseInFilename('SEE LICENSE IN ../COPYING')).toBeNull();
    expect(parseSeeLicenseInFilename('SEE LICENSE IN foo/COPYING')).toBeNull();
    expect(parseSeeLicenseInFilename('SEE LICENSE IN foo\\COPYING')).toBeNull();
    expect(parseSeeLicenseInFilename('MIT')).toBeNull();
  });
});

describe('licenseFromPackageManifest', () => {
  it('reads string and object license fields', () => {
    expect(licenseFromPackageManifest({ license: 'MIT' })).toBe('MIT');
    expect(licenseFromPackageManifest({ license: { type: 'Apache-2.0' } })).toBe('Apache-2.0');
  });

  it('reads legacy licenses arrays', () => {
    expect(licenseFromPackageManifest({ licenses: [{ type: 'MIT' }] })).toBe('MIT');
    expect(
      licenseFromPackageManifest({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] }),
    ).toBe('MIT OR Apache-2.0');
  });
});

describe('enrichPnpmLicensesJson', () => {
  it('repairs Unknown entries from hoisted package.json manifests', () => {
    const files = new Map([
      [
        '/repo/node_modules/@scope/pkg/package.json',
        JSON.stringify({ name: '@scope/pkg', license: 'MIT' }),
      ],
    ]);
    const enriched = enrichPnpmLicensesJson(
      {
        Unknown: [
          {
            name: '@scope/pkg',
            versions: ['1.0.0'],
            paths: ['/missing/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg'],
            license: 'Unknown',
          },
        ],
      },
      {
        root: '/repo',
        existsSync: (p) => files.has(p),
        readFileSync: (p) => {
          const v = files.get(p);
          if (v == null) throw new Error(`missing ${p}`);
          return v;
        },
      },
    );
    expect(Object.keys(enriched)).toEqual(['MIT']);
    expect(enriched.MIT).toEqual([
      expect.objectContaining({ name: '@scope/pkg', license: 'MIT', versions: ['1.0.0'] }),
    ]);
  });

  it('resolves SEE LICENSE IN LICENSE via the LICENSE file', () => {
    const files = new Map([
      [
        '/repo/node_modules/react-leaflet-cluster/package.json',
        JSON.stringify({ name: 'react-leaflet-cluster', license: 'SEE LICENSE IN LICENSE' }),
      ],
      [
        '/repo/node_modules/react-leaflet-cluster/LICENSE',
        'MIT License\n\nCopyright (c) 2021\n\nPermission is hereby granted, free of charge',
      ],
    ]);
    const enriched = enrichPnpmLicensesJson(
      {
        'SEE LICENSE IN LICENSE': [
          {
            name: 'react-leaflet-cluster',
            versions: ['4.1.3'],
            paths: [],
            license: 'SEE LICENSE IN LICENSE',
          },
        ],
      },
      {
        root: '/repo',
        existsSync: (p) => files.has(p),
        readFileSync: (p) => {
          const v = files.get(p);
          if (v == null) throw new Error(`missing ${p}`);
          return v;
        },
      },
    );
    expect(Object.keys(enriched)).toEqual(['MIT']);
  });

  it('resolves SEE LICENSE IN COPYING via the declared COPYING file', () => {
    const files = new Map([
      [
        '/repo/node_modules/copying-pkg/package.json',
        JSON.stringify({ name: 'copying-pkg', license: 'SEE LICENSE IN COPYING' }),
      ],
      [
        '/repo/node_modules/copying-pkg/COPYING',
        'MIT License\n\nCopyright (c) 2024\n\nPermission is hereby granted, free of charge',
      ],
    ]);
    const enriched = enrichPnpmLicensesJson(
      {
        'SEE LICENSE IN COPYING': [
          {
            name: 'copying-pkg',
            versions: ['1.0.0'],
            paths: [],
            license: 'SEE LICENSE IN COPYING',
          },
        ],
      },
      {
        root: '/repo',
        existsSync: (p) => files.has(p),
        readFileSync: (p) => {
          const v = files.get(p);
          if (v == null) throw new Error(`missing ${p}`);
          return v;
        },
      },
    );
    expect(Object.keys(enriched)).toEqual(['MIT']);
    expect(enriched.MIT).toEqual([
      expect.objectContaining({ name: 'copying-pkg', license: 'MIT', versions: ['1.0.0'] }),
    ]);
  });

  it('maps @jsr/meshtastic__* Unknown licenses via @meshtastic LICENSE files', () => {
    const files = new Map([
      [
        '/repo/node_modules/@meshtastic/core/package.json',
        JSON.stringify({ name: '@meshtastic/core' }),
      ],
      [
        '/repo/node_modules/@meshtastic/core/LICENSE',
        'GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n',
      ],
    ]);
    const enriched = enrichPnpmLicensesJson(
      {
        Unknown: [
          {
            name: '@jsr/meshtastic__core',
            versions: ['2.6.6'],
            paths: [],
            license: 'Unknown',
          },
        ],
      },
      {
        root: '/repo',
        existsSync: (p) => files.has(p),
        readFileSync: (p) => {
          const v = files.get(p);
          if (v == null) throw new Error(`missing ${p}`);
          return v;
        },
      },
    );
    expect(Object.keys(enriched)).toEqual(['GPL-3.0-only']);
  });
});

describe('ALLOWED_LICENSE_IDS', () => {
  it('includes Hippocratic 2.1 and 3.0', () => {
    expect(ALLOWED_LICENSE_IDS).toContain('Hippocratic-2.1');
    expect(ALLOWED_LICENSE_IDS).toContain('Hippocratic-3.0');
  });

  it('includes PSF-2.0 alongside Python-2.0', () => {
    expect(ALLOWED_LICENSE_IDS).toContain('Python-2.0');
    expect(ALLOWED_LICENSE_IDS).toContain('PSF-2.0');
  });
});
