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

import {
  ANDROID_ABIS,
  IOS_DEVICE_TARGET,
  MOBILE_SIDECAR_FEATURES,
  androidCargoEnv,
  androidOutputPath,
  ndkHostTag,
  parseMobileArgs,
  resolveAndroidNdk,
} from './build-mobile-sidecar.mjs';

const fixtures = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseMobileArgs', () => {
  it('builds every Android ABI with the mobile feature set by default', () => {
    expect(parseMobileArgs(['android'])).toMatchObject({
      platform: 'android',
      abis: ['arm64-v8a', 'x86_64'],
      debug: false,
      skipClone: false,
      features: 'rns-stack,rns-rnode-tcp',
    });
    expect(MOBILE_SIDECAR_FEATURES).not.toMatch(/ble|serial/);
  });

  it('accepts repeated or comma-separated ABIs and rejects unknown ones', () => {
    expect(parseMobileArgs(['android', '--abi', 'x86_64']).abis).toEqual(['x86_64']);
    expect(parseMobileArgs(['android', '--abi=arm64-v8a,x86_64']).abis).toEqual([
      'arm64-v8a',
      'x86_64',
    ]);
    expect(() => parseMobileArgs(['android', '--abi', 'armeabi-v7a'])).toThrow(/Unsupported --abi/);
  });

  it('limits --target to ios --check and defaults it to the device triple', () => {
    expect(parseMobileArgs(['ios', '--check']).iosTargets).toEqual([IOS_DEVICE_TARGET]);
    expect(
      parseMobileArgs(['ios', '--check', '--target', 'aarch64-apple-ios-sim', '--features', ''])
        .features,
    ).toBe('');
    expect(() => parseMobileArgs(['ios', '--target', 'x86_64-apple-ios'])).toThrow(/--check/);
    expect(() => parseMobileArgs(['ios', '--check', '--target', 'x86_64-apple-darwin'])).toThrow(
      /Unsupported --target/,
    );
    expect(() => parseMobileArgs(['android', '--check'])).toThrow(/ios only/);
    expect(() => parseMobileArgs(['ios', '--abi', 'x86_64'])).toThrow(/android only/);
  });

  it.each([[[]], [['windows']], [['android', 'extra']]])('rejects usage %j', (argv) => {
    expect(() => parseMobileArgs(argv)).toThrow(/Usage/);
  });
});

describe('Android NDK toolchain', () => {
  const fakeFs = (dirs) => ({
    exists: (p) => dirs.some((dir) => dir === p || dir.startsWith(`${p}${path.sep}`)),
    listDir: (p) => [
      ...new Set(
        dirs
          .filter((dir) => dir.startsWith(`${p}${path.sep}`))
          .map((dir) => dir.slice(p.length + 1).split(path.sep)[0]),
      ),
    ],
  });

  it('prefers an explicit NDK env var', () => {
    const deps = fakeFs(['/opt/ndk-r28']);
    expect(resolveAndroidNdk({ ANDROID_NDK_HOME: '/opt/ndk-r28' }, deps)).toBe('/opt/ndk-r28');
    expect(resolveAndroidNdk({ ANDROID_NDK_HOME: '/missing' }, deps)).toBeNull();
  });

  it('picks the newest numeric NDK under the SDK', () => {
    const sdk = path.join('/sdk', 'ndk');
    const deps = fakeFs(
      ['27.1.12297006', '28.2.13676358', '28.10.1', 'not-a-version'].map((v) => path.join(sdk, v)),
    );
    expect(resolveAndroidNdk({ ANDROID_HOME: '/sdk' }, deps)).toBe(path.join(sdk, '28.10.1'));
  });

  it.each([
    ['linux', path.join('/home/u', 'Android', 'Sdk')],
    ['darwin', path.join('/home/u', 'Library', 'Android', 'sdk')],
  ])('uses the default %s SDK location', (platform, sdk) => {
    const ndk = path.join(sdk, 'ndk', '28.2.13676358');
    expect(resolveAndroidNdk({}, { home: '/home/u', platform, ...fakeFs([ndk]) })).toBe(ndk);
    expect(resolveAndroidNdk({}, { home: '/home/u', platform, ...fakeFs([]) })).toBeNull();
  });

  it('points linker and C toolchain at the API 24 clang wrappers', () => {
    const bin = path.join('/ndk', 'toolchains', 'llvm', 'prebuilt', 'linux-x86_64', 'bin');
    expect(androidCargoEnv('/ndk', 'aarch64-linux-android', { platform: 'linux' })).toEqual({
      CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER: path.join(bin, 'aarch64-linux-android24-clang'),
      CC_aarch64_linux_android: path.join(bin, 'aarch64-linux-android24-clang'),
      CXX_aarch64_linux_android: path.join(bin, 'aarch64-linux-android24-clang++'),
      AR_aarch64_linux_android: path.join(bin, 'llvm-ar'),
    });
    expect(ndkHostTag('darwin')).toBe('darwin-x86_64');
  });

  it('stages the executable where the MeshProcess plugin execs it', () => {
    expect(androidOutputPath('/repo', 'arm64-v8a')).toBe(
      path.join('/repo/mobile/android/app/src/main/jniLibs/arm64-v8a/libmesh_client_reticulum.so'),
    );
  });
});

describe('build-mobile-sidecar.mjs (fake cargo + NDK)', () => {
  function fixture() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mobile-sidecar-'));
    fixtures.push(root);
    for (const dir of ['scripts/lib', 'reticulum-sidecar', 'bin']) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const file of ['build-mobile-sidecar.mjs', 'reticulum-sidecar-staging.mjs']) {
      copyFileSync(new URL(file, import.meta.url), path.join(root, 'scripts', file));
    }
    copyFileSync(
      new URL('./lib/path-under-root.mjs', import.meta.url),
      path.join(root, 'scripts/lib/path-under-root.mjs'),
    );
    const record = `const fs = require('node:fs');
fs.appendFileSync(process.env.CALLS, JSON.stringify({ tool: require('node:path').basename(process.argv[1]), args: process.argv.slice(2),
  linker: process.env.CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER ?? null }) + '\\n');`;
    const tools = {
      cargo: `${record}
const args = process.argv.slice(2);
const target = args[args.indexOf('--target') + 1];
const dir = require('node:path').join('target', target, args.includes('--release') ? 'release' : 'debug');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(require('node:path').join(dir, 'mesh-client-reticulum'), Buffer.alloc(2 * 1024 * 1024));`,
      rustup: `${record}
process.stdout.write(process.env.RUST_TARGETS.split(',').join('\\n') + '\\n');`,
    };
    for (const [name, body] of Object.entries(tools)) {
      writeFileSync(path.join(root, 'bin', name), `#!/usr/bin/env node\n${body}\n`);
      chmodSync(path.join(root, 'bin', name), 0o755);
    }
    const ndkBin = path.join(root, 'ndk/toolchains/llvm/prebuilt', ndkHostTag(), 'bin');
    mkdirSync(ndkBin, { recursive: true });
    writeFileSync(
      path.join(ndkBin, 'llvm-strip'),
      `#!/usr/bin/env node\n${record}\nfs.truncateSync(process.argv.at(-1), 1536 * 1024);\n`,
    );
    chmodSync(path.join(ndkBin, 'llvm-strip'), 0o755);
    return root;
  }

  function build(root, args, env = {}) {
    return spawnSync(
      process.execPath,
      [path.join(root, 'scripts/build-mobile-sidecar.mjs'), ...args],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
          CALLS: path.join(root, 'calls.jsonl'),
          ANDROID_NDK_HOME: path.join(root, 'ndk'),
          RUST_TARGETS: Object.values(ANDROID_ABIS).join(','),
          ...env,
        },
      },
    );
  }

  const calls = (root) =>
    existsSync(path.join(root, 'calls.jsonl'))
      ? readFileSync(path.join(root, 'calls.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : [];

  it.skipIf(process.platform === 'win32')(
    'cross-builds the executable, strips the staged copy and keeps target/ unstripped',
    () => {
      const root = fixture();
      const result = build(root, ['android', '--abi', 'x86_64', '--skip-clone']);
      expect(result.status, result.stderr).toBe(0);
      const staged = androidOutputPath(root, 'x86_64');
      expect(statSync(staged).size).toBe(1536 * 1024);
      expect(statSync(staged).mode & 0o111).not.toBe(0);
      const built = path.join(root, 'reticulum-sidecar/target/x86_64-linux-android/release');
      expect(statSync(path.join(built, 'mesh-client-reticulum')).size).toBe(2 * 1024 * 1024);
      const [rustup, cargo, strip] = calls(root);
      expect(rustup.tool).toBe('rustup');
      expect(cargo.args).toEqual([
        'build',
        '--release',
        '--target',
        'x86_64-linux-android',
        '--features',
        'rns-stack,rns-rnode-tcp',
        '--bin',
        'mesh-client-reticulum',
      ]);
      expect(cargo.linker).toMatch(/x86_64-linux-android24-clang$/);
      expect(strip.args).toEqual(['--strip-all', staged]);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'fails with the rustup command for missing targets',
    () => {
      const root = fixture();
      const result = build(root, ['android', '--skip-clone'], {
        RUST_TARGETS: 'x86_64-linux-android',
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('rustup target add aarch64-linux-android');
      expect(existsSync(androidOutputPath(root, 'x86_64'))).toBe(false);
    },
  );

  it.skipIf(process.platform === 'darwin' || process.platform === 'win32')(
    'refuses to package iOS off macOS but still allows --check',
    () => {
      const root = fixture();
      const result = build(root, ['ios', '--skip-clone']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ios --check');
      expect(calls(root)).toEqual([]);
    },
  );
});
