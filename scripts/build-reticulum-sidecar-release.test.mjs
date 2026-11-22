// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseBuildArgs } from './build-reticulum-sidecar-release.mjs';
import { PLATFORM_TARGETS, stagedSidecarPath } from './reticulum-sidecar-staging.mjs';
import { linuxZigbuildTarget } from './check-reticulum-sidecar-glibc.mjs';

const fixtures = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-sidecar-build-'));
  fixtures.push(root);
  for (const dir of ['scripts', 'scripts/lib', 'reticulum-sidecar', 'bin']) {
    mkdirSync(path.join(root, dir));
  }
  for (const file of [
    'build-reticulum-sidecar-release.mjs',
    'reticulum-sidecar-staging.mjs',
    'check-reticulum-sidecar-glibc.mjs',
  ]) {
    copyFileSync(new URL(file, import.meta.url), path.join(root, 'scripts', file));
  }
  copyFileSync(
    new URL('./lib/path-under-root.mjs', import.meta.url),
    path.join(root, 'scripts/lib/path-under-root.mjs'),
  );
  writeFileSync(path.join(root, 'scripts/clone-ratspeak-stack.sh'), 'exit "${FAIL_CLONE:-0}"\n');
  const cargo = path.join(root, 'bin/cargo');
  writeFileSync(
    cargo,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CARGO_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'zigbuild' && args[1] === '--help') process.exit(0);
if (process.env.FAIL_CARGO === args[0]) process.exit(42);
if ((args[0] === 'build' || args[0] === 'zigbuild') && process.env.BINARY_MODE !== 'missing') {
  const rawTarget = args[args.indexOf('--target') + 1];
  const target = String(rawTarget).replace(/\\.\\d+(?:\\.\\d+)*$/, '');
  const dir = path.join('target', target, 'release');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mesh-client-reticulum' + (target.includes('windows') ? '.exe' : '')),
    Buffer.alloc(process.env.BINARY_MODE === 'small' ? 12 : 1024 * 1024));
}
`,
  );
  chmodSync(cargo, 0o755);
  const zig = path.join(root, 'bin/zig');
  writeFileSync(zig, '#!/bin/sh\necho 0.14.1\n');
  chmodSync(zig, 0o755);
  return root;
}

function build(root, args, env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(root, 'scripts/build-reticulum-sidecar-release.mjs'), ...args],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
        CARGO_CALLS: path.join(root, 'calls.jsonl'),
        ...env,
      },
    },
  );
}

function calls(root) {
  const file = path.join(root, 'calls.jsonl');
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : [];
}

/** @param {string} platform */
function releaseBuildArgs(platform, cargoTarget) {
  if (platform === 'linux') {
    return [
      'zigbuild',
      '--release',
      '--target',
      linuxZigbuildTarget(cargoTarget),
      '--features',
      'rns-stack,rns-ble,rns-rnode-tcp',
    ];
  }
  return [
    'build',
    '--release',
    '--target',
    cargoTarget,
    '--features',
    'rns-stack,rns-ble,rns-rnode-tcp',
  ];
}

describe('sidecar release target selection', () => {
  it.each(['win32', 'linux', 'darwin'])(
    'keeps both %s targets and tests by default',
    (platform) => {
      expect(parseBuildArgs(['--platform', platform])).toEqual({
        platform,
        targets: PLATFORM_TARGETS[platform],
        skipTests: false,
      });
    },
  );

  it.each(['x64', 'arm64'])('selects only %s for an explicit build', (arch) => {
    const result = parseBuildArgs(['--platform=linux', `--arch=${arch}`, '--skip-tests']);
    expect(result.targets).toEqual(
      PLATFORM_TARGETS.linux.filter((target) => target.archKey === arch),
    );
    expect(result.skipTests).toBe(true);
  });

  it.each(
    [
      [],
      ['--platform'],
      ['--platform', 'other'],
      ['--platform', 'linux', '--arch', 'ia32'],
      ['--platform', 'linux', '--arch='],
      ['--platform', 'linux', '--skip-tests'],
      ['--platform', 'linux', '--typo'],
    ].map((args) => ({ args })),
  )('rejects invalid arguments $args before building', ({ args }) => {
    expect(() => parseBuildArgs(args)).toThrow();
  });
});

describe.skipIf(process.platform === 'win32')('sidecar build subprocesses', () => {
  it.each(['win32', 'linux', 'darwin'])(
    'still tests and rebuilds %s when a previous target binary exists',
    (platform) => {
      const root = fixture();
      const target = PLATFORM_TARGETS[platform][0];
      const binary = path.join(
        root,
        'reticulum-sidecar/target',
        target.cargoTarget,
        'release',
        `mesh-client-reticulum${platform === 'win32' ? '.exe' : ''}`,
      );
      mkdirSync(path.dirname(binary), { recursive: true });
      writeFileSync(binary, Buffer.alloc(1024 * 1024, 123));

      const result = build(root, ['--platform', platform, '--arch', target.archKey]);
      expect(result.status, result.stderr).toBe(0);
      const recorded = calls(root).filter(
        (args) => !(args[0] === 'zigbuild' && args[1] === '--help'),
      );
      expect(recorded.map(([command]) => command)).toEqual([
        'test',
        platform === 'linux' ? 'zigbuild' : 'build',
      ]);
      const staged = readFileSync(stagedSidecarPath(root, platform, target.archKey));
      expect(staged.equals(Buffer.alloc(1024 * 1024))).toBe(true);
    },
  );

  it.each(['win32', 'linux', 'darwin'])('tests once and stages both %s binaries', (platform) => {
    const root = fixture();
    const result = build(root, ['--platform', platform]);
    expect(result.status, result.stderr).toBe(0);
    const recorded = calls(root).filter(
      (args) => !(args[0] === 'zigbuild' && args[1] === '--help'),
    );
    expect(recorded).toEqual([
      ['test', '--features', 'rns-stack,rns-ble,rns-rnode-tcp', '--', '--test-threads=1'],
      ...PLATFORM_TARGETS[platform].map(({ cargoTarget }) =>
        releaseBuildArgs(platform, cargoTarget),
      ),
    ]);
    for (const { archKey } of PLATFORM_TARGETS[platform]) {
      const staged = stagedSidecarPath(root, platform, archKey);
      expect(statSync(staged).size).toBe(1024 * 1024);
      if (platform !== 'win32') expect(statSync(staged).mode & 0o111).toBe(0o111);
    }
  });

  it('cross-builds only the requested architecture when host tests run in another job', () => {
    const root = fixture();
    const result = build(root, ['--platform', 'win32', '--arch', 'arm64', '--skip-tests']);
    expect(result.status, result.stderr).toBe(0);
    expect(calls(root)).toEqual([
      [
        'build',
        '--release',
        '--target',
        'aarch64-pc-windows-msvc',
        '--features',
        'rns-stack,rns-ble,rns-rnode-tcp',
      ],
    ]);
    expect(existsSync(stagedSidecarPath(root, 'win32', 'x64'))).toBe(false);
    expect(existsSync(stagedSidecarPath(root, 'win32', 'arm64'))).toBe(true);
  });

  it('requires zig + cargo-zigbuild for Linux release builds', () => {
    const root = fixture();
    // Shadow host zig: fixture bin is first on PATH; a nonzero stub makes zigOnPath fail.
    writeFileSync(path.join(root, 'bin/zig'), '#!/bin/sh\nexit 1\n');
    chmodSync(path.join(root, 'bin/zig'), 0o755);
    const result = build(root, ['--platform', 'linux', '--arch', 'x64', '--skip-tests']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('docs/ci-cd.md#linux-sidecar-glibc');
  });

  it.each([
    [{ FAIL_CLONE: '19' }, 0],
    [{ FAIL_CARGO: 'test' }, 1],
    [{ FAIL_CARGO: 'zigbuild' }, 2],
    [{ BINARY_MODE: 'missing' }, 2],
    [{ BINARY_MODE: 'small' }, 2],
  ])('fails before staging on %j', (env, count) => {
    const root = fixture();
    const result = build(root, ['--platform', 'linux'], env);
    expect(result.status).not.toBe(0);
    // cargo zigbuild --help probe may append one call before the failing zigbuild.
    const recorded = calls(root).filter(
      (args) => !(args[0] === 'zigbuild' && args[1] === '--help'),
    );
    expect(recorded).toHaveLength(count);
    expect(existsSync(stagedSidecarPath(root, 'linux', 'x64'))).toBe(false);
  });
});
