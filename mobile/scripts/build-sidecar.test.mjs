// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
  SIDECAR_RELATIVE_DEP_PATHS,
  SIDECAR_SHARED_INPUTS,
  androidCargoEnv,
  androidOutputPath,
  mobileSidecarManifest,
  ndkHostTag,
  parseMobileArgs,
  resolveAndroidNdk,
  stageSidecarCrate,
} from './build-sidecar.mjs';

const REPO = path.resolve(import.meta.dirname, '..', '..');
/** The real desktop manifest: the stage must keep working against it. */
const DESKTOP_MANIFEST = readFileSync(path.join(REPO, 'reticulum-sidecar/Cargo.toml'), 'utf8');
const SERIAL_TABLE = `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies.rns-runtime]`;

const fixtures = [];
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(prefix = 'mesh-mobile-sidecar-') {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  fixtures.push(root);
  return root;
}

/** @param {string} root @param {string} rel @param {string} text */
function put(root, rel, text) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
}

/**
 * A repository-shaped fixture: the desktop crate (with the real Cargo.toml unless overridden),
 * the files its sources read outside src/, the .rsstack dependency directories and the mobile
 * library root.
 */
function repoFixture(root = tempRoot(), { manifest = DESKTOP_MANIFEST } = {}) {
  put(root, 'reticulum-sidecar/Cargo.toml', manifest);
  put(root, 'reticulum-sidecar/Cargo.lock', '# lock\nversion = 4\n');
  put(root, 'reticulum-sidecar/rust-toolchain.toml', '[toolchain]\nchannel = "stable"\n');
  put(root, 'reticulum-sidecar/src/main.rs', 'mod stack;\nfn main() {}\n');
  put(
    root,
    'reticulum-sidecar/src/stack/mod.rs',
    '#[path = "../../vendor/ratspeak_vault.rs"]\nmod vault;\nmod inputs;\n',
  );
  put(
    root,
    'reticulum-sidecar/src/stack/inputs.rs',
    SIDECAR_SHARED_INPUTS.map((rel) => `const _: &str = include_str!("../../../${rel}");\n`).join(
      '',
    ),
  );
  put(root, 'reticulum-sidecar/vendor/ratspeak_vault.rs', '// vault\n');
  put(root, 'reticulum-sidecar/target/debug/mesh-client-reticulum', 'cargo output\n');
  for (const rel of SIDECAR_SHARED_INPUTS) put(root, rel, '{}\n');
  put(root, 'mobile/native/reticulum-lib/lib.rs', 'pub async fn run() -> u8 { 0 }\n');
  mkdirSync(path.join(root, 'mobile/native/reticulum-ffi'), { recursive: true });
  for (const [, rel] of DESKTOP_MANIFEST.matchAll(/path = "\.\.\/([^"]+)"/g)) {
    mkdirSync(path.join(root, rel), { recursive: true });
  }
  return root;
}

const stageDir = (root) => path.join(root, 'mobile/native/.stage');
const stageCrate = (root) => path.join(stageDir(root), 'reticulum-sidecar');

/** Every file under `dir` (posix, relative) with its mtime. */
function mtimes(dir) {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const abs = path.join(entry.parentPath, entry.name);
        return [path.relative(dir, abs).split(path.sep).join('/'), statSync(abs).mtimeMs];
      }),
  );
}

/** The `[...]` header that owns each line of a TOML text. */
function sectionOf(text, needle) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line === needle);
  expect(at, `${needle} not found`).toBeGreaterThan(-1);
  return lines
    .slice(0, at)
    .reverse()
    .find((line) => line.startsWith('['));
}

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

  it('accepts stage alone and refuses platform flags with it', () => {
    expect(parseMobileArgs(['stage', '--skip-clone'])).toMatchObject({
      platform: 'stage',
      skipClone: true,
    });
    expect(() => parseMobileArgs(['stage', '--abi', 'x86_64'])).toThrow(/android only/);
    expect(() => parseMobileArgs(['stage', '--check'])).toThrow(/ios only/);
  });

  it.each([[[]], [['windows']], [['android', 'extra']]])('rejects usage %j', (argv) => {
    expect(() => parseMobileArgs(argv)).toThrow(/Usage/);
  });
});

describe('mobileSidecarManifest (real reticulum-sidecar/Cargo.toml)', () => {
  const layout = { sidecarDir: path.join(REPO, 'reticulum-sidecar'), repoRoot: REPO };

  it('adds the library target once, before the executable', () => {
    const text = mobileSidecarManifest(DESKTOP_MANIFEST, layout);
    expect(text.match(/^\[lib\]$/gm)).toHaveLength(1);
    expect(text.indexOf('[lib]')).toBeLessThan(text.indexOf('[[bin]]'));
    expect(sectionOf(text, 'name = "mesh_client_reticulum"')).toBe('[lib]');
    expect(sectionOf(text, 'path = "src/lib.rs"')).toBe('[lib]');
  });

  it('keeps the serial feature for desktop targets only', () => {
    const text = mobileSidecarManifest(DESKTOP_MANIFEST, layout);
    expect(text.match(/^features = \["serial"\]$/gm)).toHaveLength(1);
    expect(sectionOf(text, 'features = ["serial"]')).toBe(SERIAL_TABLE);
    const base = text.slice(text.indexOf('[dependencies.rns-runtime]'));
    expect(base.slice(0, base.indexOf('\n\n'))).not.toContain('features');
  });

  it('points every relative dependency at its real absolute location', () => {
    const text = mobileSidecarManifest(DESKTOP_MANIFEST, layout);
    const desktop = [...DESKTOP_MANIFEST.matchAll(/path = "(\.\.\/[^"]+)"/g)].map(([, p]) => p);
    expect(desktop).toHaveLength(SIDECAR_RELATIVE_DEP_PATHS);
    const staged = [...text.matchAll(/path = "([^"]+)"/g)].map(([, p]) => p);
    expect(staged.filter((p) => !p.startsWith('src/'))).toEqual(
      [desktop[0], ...desktop].map((rel) =>
        path.resolve(layout.sidecarDir, rel).split(path.sep).join('/'),
      ),
    );
    expect(text).not.toContain('"../');
  });

  it.each([
    ['no [[bin]] section', (t) => t.replace('\n[[bin]]\n', '\n[[bins]]\n'), /\[\[bin\]\] section/],
    [
      'an existing [lib]',
      (t) => t.replace('\n[[bin]]\n', '\n[lib]\n\n[[bin]]\n'),
      /already has a \[lib\]/,
    ],
    [
      'serial moved off rns-runtime',
      (t) => t.replace('optional = true\nfeatures = ["serial"]', 'optional = true'),
      /features = \["serial"\]/,
    ],
    [
      'a new relative dependency',
      (t) => `${t}\n[dependencies.extra]\npath = "../.rsstack/extra"\noptional = true\n`,
      `expected ${String(SIDECAR_RELATIVE_DEP_PATHS)}`,
    ],
  ])('fails loudly on %s', (_what, mutate, message) => {
    const mutated = mutate(DESKTOP_MANIFEST);
    expect(mutated).not.toBe(DESKTOP_MANIFEST);
    expect(() => mobileSidecarManifest(mutated, layout)).toThrow(message);
  });

  it('reads CRLF manifests', () => {
    const text = mobileSidecarManifest(DESKTOP_MANIFEST.replaceAll('\n', '\r\n'), layout);
    expect(text).toBe(mobileSidecarManifest(DESKTOP_MANIFEST, layout));
  });
});

describe('stageSidecarCrate', () => {
  it('stages the desktop crate with the mobile library and its outside inputs', () => {
    const root = repoFixture();
    const stage = stageSidecarCrate({ repoRoot: root });
    const crate = stageCrate(root);
    expect(stage.crateDir).toBe(crate);
    expect(stage.manifestPath).toBe(path.join(crate, 'Cargo.toml'));
    expect(stage.removed).toEqual([]);

    const manifest = readFileSync(stage.manifestPath, 'utf8');
    expect(manifest.match(/^\[lib\]$/gm)).toHaveLength(1);
    expect(sectionOf(manifest, 'features = ["serial"]')).toBe(SERIAL_TABLE);
    expect(stage.dependencyPaths).toHaveLength(SIDECAR_RELATIVE_DEP_PATHS + 1);
    for (const dep of stage.dependencyPaths) {
      expect(path.isAbsolute(dep), dep).toBe(true);
      expect(existsSync(dep), dep).toBe(true);
      expect(dep.startsWith(path.join(root, '.rsstack')), dep).toBe(true);
    }

    const same = (stagedRel, sourceRel) =>
      expect(readFileSync(path.join(crate, stagedRel), 'utf8')).toBe(
        readFileSync(path.join(root, sourceRel), 'utf8'),
      );
    same('src/lib.rs', 'mobile/native/reticulum-lib/lib.rs');
    same('src/main.rs', 'reticulum-sidecar/src/main.rs');
    same('src/stack/mod.rs', 'reticulum-sidecar/src/stack/mod.rs');
    same('vendor/ratspeak_vault.rs', 'reticulum-sidecar/vendor/ratspeak_vault.rs');
    same('Cargo.lock', 'reticulum-sidecar/Cargo.lock');
    same('rust-toolchain.toml', 'reticulum-sidecar/rust-toolchain.toml');
    // include_str!("../../../src/shared/...") from src/stack resolves beside the stage crate.
    for (const rel of SIDECAR_SHARED_INPUTS) {
      expect(existsSync(path.join(crate, 'src/stack/../../..', rel)), rel).toBe(true);
    }
    expect(existsSync(path.join(crate, 'target'))).toBe(false);
    expect(stage.written).toContain('reticulum-sidecar/src/lib.rs');
  });

  it('rewrites nothing on a second run and only what changed after an edit', () => {
    const root = repoFixture();
    stageSidecarCrate({ repoRoot: root });
    const before = mtimes(stageDir(root));
    const again = stageSidecarCrate({ repoRoot: root });
    expect(again).toMatchObject({ written: [], removed: [] });
    expect(mtimes(stageDir(root))).toEqual(before);

    put(root, 'reticulum-sidecar/src/main.rs', 'mod stack;\nfn main() { let _ = 1; }\n');
    put(root, 'reticulum-sidecar/src/extra.rs', '// new upstream module\n');
    expect(stageSidecarCrate({ repoRoot: root })).toMatchObject({
      written: ['reticulum-sidecar/src/extra.rs', 'reticulum-sidecar/src/main.rs'],
      removed: [],
    });
    rmSync(path.join(root, 'reticulum-sidecar/src/extra.rs'));
    expect(stageSidecarCrate({ repoRoot: root })).toMatchObject({
      written: [],
      removed: ['reticulum-sidecar/src/extra.rs'],
    });
  });

  it('keeps cargo output inside the stage crate', () => {
    const root = repoFixture();
    stageSidecarCrate({ repoRoot: root });
    put(stageCrate(root), 'target/debug/build-output', 'cargo\n');
    expect(stageSidecarCrate({ repoRoot: root }).removed).toEqual([]);
    expect(existsSync(path.join(stageCrate(root), 'target/debug/build-output'))).toBe(true);
  });

  it('fails loudly, writing nothing, when the manifest anchor is missing', () => {
    const manifest = DESKTOP_MANIFEST.replace('\n[[bin]]\n', '\n[[binary]]\n');
    expect(manifest).not.toBe(DESKTOP_MANIFEST);
    const root = repoFixture(tempRoot(), { manifest });
    expect(() => stageSidecarCrate({ repoRoot: root })).toThrow(/\[\[bin\]\] section/);
    expect(existsSync(stageDir(root))).toBe(false);
  });

  it('fails loudly when upstream adds src/lib.rs or reads an unlisted file', () => {
    const withLib = repoFixture();
    put(withLib, 'reticulum-sidecar/src/lib.rs', 'pub fn x() {}\n');
    expect(() => stageSidecarCrate({ repoRoot: withLib })).toThrow(/src\/lib\.rs exists upstream/);

    const withInput = repoFixture();
    put(
      withInput,
      'reticulum-sidecar/src/stack/more.rs',
      'const _: &str = include_str!("../../../src/shared/newTable.json");\n',
    );
    expect(() => stageSidecarCrate({ repoRoot: withInput })).toThrow(/SIDECAR_SHARED_INPUTS/);
    expect(existsSync(stageDir(withInput))).toBe(false);
  });

  it('lists every outside file the real sidecar sources read', () => {
    const referenced = new Set();
    const src = path.join(REPO, 'reticulum-sidecar/src');
    for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.rs')) continue;
      const text = readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
      for (const [ref] of text.matchAll(/\bsrc\/shared\/[^"\s]+(?=")/g)) referenced.add(ref);
    }
    expect([...referenced].sort()).toEqual([...SIDECAR_SHARED_INPUTS].sort());
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

describe('build-sidecar.mjs (fake cargo + NDK)', () => {
  function fixture() {
    const root = repoFixture();
    for (const dir of ['mobile/scripts', 'scripts/lib', 'bin']) {
      mkdirSync(path.join(root, dir), { recursive: true });
    }
    copyFileSync(
      new URL('./build-sidecar.mjs', import.meta.url),
      path.join(root, 'mobile/scripts/build-sidecar.mjs'),
    );
    for (const rel of [
      'scripts/reticulum-sidecar-staging.mjs',
      'scripts/lib/path-under-root.mjs',
    ]) {
      copyFileSync(path.join(REPO, rel), path.join(root, rel));
    }
    const record = `const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(process.env.CALLS, JSON.stringify({ tool: path.basename(process.argv[1]),
  args: process.argv.slice(2), cwd: process.cwd(),
  linker: process.env.CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER ?? null }) + '\\n');`;
    const tools = {
      cargo: `${record}
const args = process.argv.slice(2);
const at = (flag) => args[args.indexOf(flag) + 1];
const dir = path.join(at('--target-dir'), at('--target'), args.includes('--release') ? 'release' : 'debug');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'mesh-client-reticulum'), Buffer.alloc(2 * 1024 * 1024));`,
      rustup: `${record}
process.stdout.write(process.env.RUST_TARGETS.split(',').join('\\n') + '\\n');`,
    };
    // The fake tools are CommonJS; without this, a TMPDIR inside mobile/ would make Node read
    // them as ES modules (mobile/package.json has "type": "module").
    writeFileSync(path.join(root, 'package.json'), '{ "type": "commonjs" }\n');
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
      [path.join(root, 'mobile/scripts/build-sidecar.mjs'), ...args],
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
    'cross-builds the staged executable, strips the copy and keeps target/ unstripped',
    () => {
      const root = fixture();
      const result = build(root, ['android', '--abi', 'x86_64', '--skip-clone']);
      expect(result.status, result.stderr).toBe(0);
      const staged = androidOutputPath(root, 'x86_64');
      expect(statSync(staged).size).toBe(1536 * 1024);
      expect(statSync(staged).mode & 0o111).not.toBe(0);
      const targetDir = path.join(root, 'reticulum-sidecar/target');
      const built = path.join(targetDir, 'x86_64-linux-android/release/mesh-client-reticulum');
      expect(statSync(built).size).toBe(2 * 1024 * 1024);
      const crate = stageCrate(root);
      expect(readFileSync(path.join(crate, 'src/lib.rs'), 'utf8')).toContain('pub async fn run');
      const [rustup, cargo, strip] = calls(root);
      expect(rustup.tool).toBe('rustup');
      expect(cargo.cwd).toBe(realpathSync(crate));
      expect(cargo.args).toEqual([
        'build',
        '--release',
        '--manifest-path',
        path.join(crate, 'Cargo.toml'),
        '--target-dir',
        targetDir,
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

  it.skipIf(process.platform === 'win32')(
    'refuses to build when a dependency directory is missing',
    () => {
      const root = fixture();
      rmSync(path.join(root, '.rsstack/lrgp-rs'), { recursive: true });
      const result = build(root, ['android', '--skip-clone']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('run without --skip-clone');
      expect(calls(root)).toEqual([]);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'stage writes the crate and seeds the FFI lockfile without running cargo',
    () => {
      const root = fixture();
      const result = build(root, ['stage', '--skip-clone']);
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(path.join(stageCrate(root), 'src/lib.rs'))).toBe(true);
      expect(readFileSync(path.join(root, 'mobile/native/reticulum-ffi/Cargo.lock'), 'utf8')).toBe(
        readFileSync(path.join(root, 'reticulum-sidecar/Cargo.lock'), 'utf8'),
      );
      expect(calls(root)).toEqual([]);
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
      expect(existsSync(stageDir(root))).toBe(false);
    },
  );
});
