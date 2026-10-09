// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  CARGO_METADATA_ARGS,
  collectRustPackages,
  evaluateRustPackages,
  formatRustLicenseCheckReport,
  runCargoMetadata,
  runRustLicenseCheck,
} from './check-rust-licenses.mjs';

/**
 * @param {string} name
 * @param {string | undefined} license
 */
function pkg(name, license, version = '1.0.0') {
  return { name, version, license, manifest_path: `/x/${name}/Cargo.toml` };
}

function sink() {
  const chunks = [];
  return {
    write: (chunk) => {
      chunks.push(chunk);
      return true;
    },
    text: () => chunks.join(''),
  };
}

describe('collectRustPackages', () => {
  it('maps cargo metadata packages', () => {
    expect(
      collectRustPackages({ packages: [pkg('rns-wire', 'AGPL-3.0-or-later', '0.1.0')] }),
    ).toEqual([
      {
        name: 'rns-wire',
        version: '0.1.0',
        license: 'AGPL-3.0-or-later',
        manifestPath: '/x/rns-wire/Cargo.toml',
      },
    ]);
  });

  it('throws on missing or malformed input', () => {
    expect(() => collectRustPackages(null)).toThrow(/expected cargo metadata JSON object/);
    expect(() => collectRustPackages([])).toThrow(/expected cargo metadata JSON object/);
    expect(() => collectRustPackages({})).toThrow(/packages array/);
    expect(() => collectRustPackages({ packages: [null] })).toThrow(/expected package object/);
  });

  it('treats a missing license field as empty', () => {
    expect(collectRustPackages({ packages: [pkg('nolicense', undefined)] })[0].license).toBe('');
  });
});

describe('evaluateRustPackages', () => {
  it('passes the license expressions found in the sidecar graph', () => {
    const packages = collectRustPackages({
      packages: [
        pkg('rns-wire', 'AGPL-3.0-or-later'),
        pkg('slash', 'MIT/Apache-2.0'),
        pkg('codec2', 'LGPL-2.1-only AND MIT AND BSD-3-Clause'),
        pkg('dual', 'MIT OR Apache-2.0'),
        pkg('llvm', 'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT'),
        pkg('bzip2', 'bzip2-1.0.6'),
      ],
    });
    const result = evaluateRustPackages(packages);
    expect(result.violations).toEqual([]);
    expect(result.packages).toHaveLength(6);
  });

  it('fails unknown, disallowed, and empty licenses with name and version', () => {
    const packages = collectRustPackages({
      packages: [
        pkg('mystery', 'Unknown', '0.2.0'),
        pkg('closed', 'GPL-3.0-only AND Proprietary', '3.1.4'),
        pkg('blank', '', '1.2.3'),
        pkg('missing', undefined, '9.9.9'),
      ],
    });
    const result = evaluateRustPackages(packages);
    expect(result.violations).toEqual([
      { license: 'Unknown', name: 'mystery', versions: ['0.2.0'] },
      { license: 'GPL-3.0-only AND Proprietary', name: 'closed', versions: ['3.1.4'] },
      { license: 'Unknown', name: 'blank', versions: ['1.2.3'] },
      { license: 'Unknown', name: 'missing', versions: ['9.9.9'] },
    ]);
    expect(result.counts.get('Unknown')).toBe(3);
  });
});

describe('formatRustLicenseCheckReport', () => {
  it('includes the summary, per-license counts, and violations', () => {
    const report = formatRustLicenseCheckReport(
      evaluateRustPackages(
        collectRustPackages({
          packages: [
            pkg('a', 'MIT'),
            pkg('b', 'MIT'),
            pkg('c', 'AGPL-3.0-or-later'),
            pkg('bad', 'Proprietary', '2.0.0'),
          ],
        }),
      ),
    );
    expect(report).toMatch(/check:rust-licenses: 4 crates across 3 license string\(s\)/);
    expect(report).toMatch(/ {2}2\tMIT/);
    expect(report).toMatch(/ {2}1\tAGPL-3\.0-or-later/);
    expect(report).toMatch(/disallowed license/);
    expect(report).toMatch(/Proprietary: bad@2\.0\.0/);
  });
});

describe('runCargoMetadata', () => {
  it('invokes cargo metadata with --locked --all-features and no --offline', () => {
    const calls = [];
    const json = runCargoMetadata({
      cwd: '/sidecar',
      spawn: (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd });
        return { status: 0, stdout: '{"packages":[]}', stderr: '' };
      },
    });
    expect(json).toEqual({ packages: [] });
    expect(calls).toEqual([{ cmd: 'cargo', args: [...CARGO_METADATA_ARGS], cwd: '/sidecar' }]);
    expect(CARGO_METADATA_ARGS).toContain('--all-features');
    expect(CARGO_METADATA_ARGS).toContain('--locked');
    expect(CARGO_METADATA_ARGS).not.toContain('--offline');
  });

  it('throws with stderr on non-zero exit', () => {
    expect(() =>
      runCargoMetadata({
        spawn: () => ({ status: 101, stdout: '', stderr: 'error: lock file needs update' }),
      }),
    ).toThrow(/cargo metadata failed \(101\): error: lock file needs update/);
  });
});

describe('runRustLicenseCheck', () => {
  const okMetadata = () => ({ packages: [pkg('a', 'MIT'), pkg('b', 'MIT/Apache-2.0')] });

  it('skips with exit 0 when cargo is missing', () => {
    const stderr = sink();
    const code = runRustLicenseCheck({
      cargoAvailable: () => false,
      rsstackPresent: () => true,
      loadMetadata: okMetadata,
      stdout: sink(),
      stderr,
    });
    expect(code).toBe(0);
    expect(stderr.text()).toMatch(/cargo not found on PATH; skipping/);
  });

  it('fails with exit 1 when cargo is missing and --require-cargo is set', () => {
    const stderr = sink();
    const code = runRustLicenseCheck({
      requireCargo: true,
      cargoAvailable: () => false,
      rsstackPresent: () => true,
      loadMetadata: okMetadata,
      stdout: sink(),
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/required by --require-cargo/);
  });

  it('fails when .rsstack is not provisioned', () => {
    const stderr = sink();
    const code = runRustLicenseCheck({
      cargoAvailable: () => true,
      rsstackPresent: () => false,
      loadMetadata: okMetadata,
      stdout: sink(),
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/clone-ratspeak-stack\.sh/);
  });

  it('passes and reports to stdout when every crate is allowed', () => {
    const stdout = sink();
    const code = runRustLicenseCheck({
      cargoAvailable: () => true,
      rsstackPresent: () => true,
      loadMetadata: okMetadata,
      stdout,
      stderr: sink(),
    });
    expect(code).toBe(0);
    expect(stdout.text()).toMatch(/2 crates across 2 license string/);
  });

  it('fails and reports to stderr on violations', () => {
    const stderr = sink();
    const code = runRustLicenseCheck({
      cargoAvailable: () => true,
      rsstackPresent: () => true,
      loadMetadata: () => ({ packages: [pkg('bad', 'Proprietary')] }),
      stdout: sink(),
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/Proprietary: bad@1\.0\.0/);
  });

  it('fails when cargo metadata throws', () => {
    const stderr = sink();
    const code = runRustLicenseCheck({
      cargoAvailable: () => true,
      rsstackPresent: () => true,
      loadMetadata: () => {
        throw new Error('check:rust-licenses: cargo metadata failed (101): boom');
      },
      stdout: sink(),
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.text()).toMatch(/boom/);
  });
});
