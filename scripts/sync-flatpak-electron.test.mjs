// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertSafeElectronSemverVersion,
  assertSafePnpmSemverVersion,
  buildElectronArchiveSourcesYaml,
  buildPnpmArchiveSourcesYaml,
  parseElectronSha256s,
  parsePnpmSha256s,
  pnpmVersionFromPackage,
  sanitizeFlatpakElectronManifestYamlForDisk,
  sanitizeFlatpakPnpmManifestYamlForDisk,
  syncFlatpakElectronManifest,
  syncFlatpakPnpmManifest,
  validateElectronSha256ByZipArch,
  validatePnpmSha256ByArch,
} from './sync-flatpak-electron.mjs';

const FIXTURE_SHASUMS = `512f4e0574dc5800c612ea904e854f602f36ac57cade971a0a2b239bfaa19e52 *electron-v41.10.1-linux-x64.zip
2420f82a84ef47fd495b57f0b2b2f9a79edec7b2fed396600380ac006dadecef *electron-v41.10.1-linux-arm64.zip`;

const SAMPLE_MANIFEST = `      - type: archive
        url: https://github.com/pnpm/pnpm/releases/download/v11.15.1/pnpm-linux-arm64.tar.gz
        sha256: 361e385867146972d0635a41a1871cb44c9c23f65acce78a5f1ca1d44ac0afcd
        dest: pnpm-vendor
        strip-components: 0
        only-arches: [aarch64]
      - type: archive
        url: https://github.com/electron/electron/releases/download/v41.10.0/electron-v41.10.0-linux-x64.zip
        sha256: b5dac00ef6b5ee4e9882cf1424fd8dce7319fb09806757399fdf3b3da06efcd2
        dest: electron-prebuilt
        only-arches: [x86_64]
      - type: archive
        url: https://github.com/electron/electron/releases/download/v41.10.0/electron-v41.10.0-linux-arm64.zip
        sha256: 2c063804e14c325cd34de1ff7528f6066d544d49a9d55c9c2937e20dd1e717e3
        dest: electron-prebuilt
        only-arches: [aarch64]`;

const PNPM_X64_SHA = 'a'.repeat(64);
const PNPM_ARM64_SHA = 'b'.repeat(64);

const PNPM_RELEASE_FIXTURE = {
  assets: [
    { name: 'pnpm-linux-x64.tar.gz', digest: `sha256:${PNPM_X64_SHA}` },
    { name: 'pnpm-linux-arm64.tar.gz', digest: `sha256:${PNPM_ARM64_SHA}` },
    { name: 'pnpm-linux-x64-musl.tar.gz', digest: `sha256:${'c'.repeat(64)}` },
  ],
};

const SAMPLE_PNPM_MANIFEST = `      - type: archive
        url: https://github.com/pnpm/pnpm/releases/download/v11.22.0/pnpm-linux-x64.tar.gz
        sha256: 4c592fa410eb23b69691a9efb9bf21c87c15b3e9d88c6ec8acdd354a0eb8de71
        dest: pnpm-vendor
        # pnpm tarball has root-level \`pnpm\` + \`dist/\`; default strip-components:1 drops the binary.
        strip-components: 0
        only-arches: [x86_64]
      - type: archive
        url: https://github.com/pnpm/pnpm/releases/download/v11.22.0/pnpm-linux-arm64.tar.gz
        sha256: f1426231f365bdfd46c15fa3d1211c3936ee2c4e557afd304f6c66dbf1b2a8bf
        dest: pnpm-vendor
        strip-components: 0
        only-arches: [aarch64]`;

describe('sync-flatpak-electron.mjs', () => {
  it('assertSafeElectronSemverVersion accepts X.Y.Z', () => {
    expect(assertSafeElectronSemverVersion('41.10.1')).toBe('41.10.1');
  });

  it('assertSafeElectronSemverVersion rejects unsafe version strings', () => {
    expect(() => assertSafeElectronSemverVersion('41.10.1-evil')).toThrow(/X\.Y\.Z/);
    expect(() => assertSafeElectronSemverVersion('../../../etc/passwd')).toThrow(/X\.Y\.Z/);
    expect(() => assertSafeElectronSemverVersion('')).toThrow(/X\.Y\.Z/);
  });

  it('validateElectronSha256ByZipArch rejects short or non-hex checksums', () => {
    const valid = parseElectronSha256s(FIXTURE_SHASUMS, '41.10.1');
    expect(validateElectronSha256ByZipArch(valid, '41.10.1')).toEqual(valid);
    expect(() =>
      validateElectronSha256ByZipArch({ x64: 'abc', arm64: valid.arm64 }, '41.10.1'),
    ).toThrow(/linux-x64 checksum/);
    expect(() =>
      validateElectronSha256ByZipArch({ x64: valid.x64, arm64: 'not-hex' }, '41.10.1'),
    ).toThrow(/linux-arm64 checksum/);
  });

  it('sanitizeFlatpakElectronManifestYamlForDisk rejects yaml missing validated checksums', () => {
    const sha256ByZipArch = parseElectronSha256s(FIXTURE_SHASUMS, '41.10.1');
    const next = syncFlatpakElectronManifest(SAMPLE_MANIFEST, '41.10.1', sha256ByZipArch);
    expect(sanitizeFlatpakElectronManifestYamlForDisk(next, '41.10.1', sha256ByZipArch)).toBe(next);
    expect(() =>
      sanitizeFlatpakElectronManifestYamlForDisk(next, '41.10.0', sha256ByZipArch),
    ).toThrow(/Electron archive URLs/);
    expect(() =>
      sanitizeFlatpakElectronManifestYamlForDisk(
        next.replace(sha256ByZipArch.x64, '0'.repeat(64)),
        '41.10.1',
        sha256ByZipArch,
      ),
    ).toThrow(/validated Electron archive checksums/);
  });

  it('parses linux x64 and arm64 checksums for a release', () => {
    expect(parseElectronSha256s(FIXTURE_SHASUMS, '41.10.1')).toEqual({
      x64: '512f4e0574dc5800c612ea904e854f602f36ac57cade971a0a2b239bfaa19e52',
      arm64: '2420f82a84ef47fd495b57f0b2b2f9a79edec7b2fed396600380ac006dadecef',
    });
  });

  it('builds vendored Electron archive source blocks', () => {
    const yaml = buildElectronArchiveSourcesYaml(
      '41.10.1',
      parseElectronSha256s(FIXTURE_SHASUMS, '41.10.1'),
    );
    expect(yaml).toContain('electron-v41.10.1-linux-x64.zip');
    expect(yaml).toContain('electron-v41.10.1-linux-arm64.zip');
    expect(yaml).toContain('only-arches: [x86_64]');
    expect(yaml).toContain('only-arches: [aarch64]');
  });

  it('replaces stale Electron archive URLs and checksums in the manifest', () => {
    const sha256ByZipArch = parseElectronSha256s(FIXTURE_SHASUMS, '41.10.1');
    const next = syncFlatpakElectronManifest(SAMPLE_MANIFEST, '41.10.1', sha256ByZipArch);
    expect(next).not.toContain('41.10.0');
    expect(next).toContain('electron-v41.10.1-linux-x64.zip');
    expect(next).toContain('electron-v41.10.1-linux-arm64.zip');
    expect(next).toContain(sha256ByZipArch.x64);
    expect(next).toContain(sha256ByZipArch.arm64);
  });
});

describe('pnpm standalone sync', () => {
  it('reads the release tag from packageManager, ignoring the integrity hash', () => {
    expect(pnpmVersionFromPackage({ packageManager: 'pnpm@11.24.0+sha512.beef' })).toBe('11.24.0');
    expect(pnpmVersionFromPackage({ packageManager: 'yarn@4.0.0' })).toBeNull();
    expect(pnpmVersionFromPackage({})).toBeNull();
  });

  it('assertSafePnpmSemverVersion rejects unsafe version strings', () => {
    expect(assertSafePnpmSemverVersion('11.24.0')).toBe('11.24.0');
    expect(() => assertSafePnpmSemverVersion('11.24.0-evil')).toThrow(/X\.Y\.Z/);
    expect(() => assertSafePnpmSemverVersion('../../etc/passwd')).toThrow(/X\.Y\.Z/);
  });

  it('parses only the glibc linux tarball digests from release assets', () => {
    expect(parsePnpmSha256s(PNPM_RELEASE_FIXTURE, '11.24.0')).toEqual({
      x64: PNPM_X64_SHA,
      arm64: PNPM_ARM64_SHA,
    });
    expect(() => parsePnpmSha256s({ assets: [] }, '11.24.0')).toThrow(/missing a sha256 digest/);
    expect(() =>
      parsePnpmSha256s(
        { assets: [{ name: 'pnpm-linux-x64.tar.gz', digest: 'md5:nope' }] },
        '11.24.0',
      ),
    ).toThrow(/missing a sha256 digest/);
  });

  it('validatePnpmSha256ByArch rejects short or non-hex checksums', () => {
    expect(() =>
      validatePnpmSha256ByArch({ x64: 'abc', arm64: PNPM_ARM64_SHA }, '11.24.0'),
    ).toThrow(/linux-x64 checksum/);
    expect(() =>
      validatePnpmSha256ByArch({ x64: PNPM_X64_SHA, arm64: 'not-hex' }, '11.24.0'),
    ).toThrow(/linux-arm64 checksum/);
  });

  it('builds archive blocks that keep strip-components: 0', () => {
    const yaml = buildPnpmArchiveSourcesYaml('11.24.0', {
      x64: PNPM_X64_SHA,
      arm64: PNPM_ARM64_SHA,
    });
    expect(yaml).toContain('download/v11.24.0/pnpm-linux-x64.tar.gz');
    expect(yaml).toContain('download/v11.24.0/pnpm-linux-arm64.tar.gz');
    expect(yaml.match(/strip-components: 0/g)).toHaveLength(2);
  });

  it('replaces stale pnpm URLs and checksums in the manifest', () => {
    const shas = parsePnpmSha256s(PNPM_RELEASE_FIXTURE, '11.24.0');
    const next = syncFlatpakPnpmManifest(SAMPLE_PNPM_MANIFEST, '11.24.0', shas);
    expect(next).not.toContain('v11.22.0');
    expect(next).toContain(PNPM_X64_SHA);
    expect(next).toContain(PNPM_ARM64_SHA);
    expect(sanitizeFlatpakPnpmManifestYamlForDisk(next, '11.24.0', shas)).toBe(next);
  });

  it('throws when the manifest has no pnpm archive blocks to replace', () => {
    expect(() => syncFlatpakPnpmManifest(SAMPLE_MANIFEST, '11.24.0', PNPM_RELEASE_FIXTURE)).toThrow(
      /missing expected pnpm archive source blocks/,
    );
  });
});

describe('syncFlatpakPnpm integration', () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeFixture(pnpmVersion) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-flatpak-pnpm-'));
    tempDirs.push(dir);
    const manifestPath = path.join(dir, 'org.coloradomesh.MeshClient.yml');
    const packagePath = path.join(dir, 'package.json');
    fs.writeFileSync(manifestPath, SAMPLE_PNPM_MANIFEST, 'utf8');
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ packageManager: `pnpm@${pnpmVersion}+sha512.beef` }, null, 2),
      'utf8',
    );
    return { manifestPath, packagePath };
  }

  it('updates a temp manifest when the pnpm pin drifts', async () => {
    const { syncFlatpakPnpm } = await import('./sync-flatpak-electron.mjs');
    const { manifestPath, packagePath } = writeFixture('11.24.0');

    const result = await syncFlatpakPnpm({
      manifestPath,
      packagePath,
      fetchFn: async () => ({ ok: true, json: async () => PNPM_RELEASE_FIXTURE }),
      write: true,
    });

    expect(result.changed).toBe(true);
    const written = fs.readFileSync(manifestPath, 'utf8');
    expect(written).toContain('download/v11.24.0/pnpm-linux-x64.tar.gz');
    expect(written).toContain(PNPM_X64_SHA);
  });

  it('skips the network round-trip when the manifest already pins the release', async () => {
    const { syncFlatpakPnpm } = await import('./sync-flatpak-electron.mjs');
    const { manifestPath, packagePath } = writeFixture('11.22.0');

    const result = await syncFlatpakPnpm({
      manifestPath,
      packagePath,
      fetchFn: async () => {
        throw new Error('fetch should not run when the pin already matches');
      },
      write: true,
    });

    expect(result.changed).toBe(false);
    expect(fs.readFileSync(manifestPath, 'utf8')).toBe(SAMPLE_PNPM_MANIFEST);
  });
});

describe('syncFlatpakElectron integration', () => {
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('updates a temp manifest when electron version drifts', async () => {
    const { syncFlatpakElectron } = await import('./sync-flatpak-electron.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-flatpak-electron-'));
    tempDirs.push(dir);

    const manifestPath = path.join(dir, 'org.coloradomesh.MeshClient.yml');
    const packagePath = path.join(dir, 'package.json');
    fs.writeFileSync(manifestPath, SAMPLE_MANIFEST, 'utf8');
    fs.writeFileSync(
      packagePath,
      JSON.stringify({ devDependencies: { electron: '^41.10.1' } }, null, 2),
      'utf8',
    );

    const fetchFn = async () => ({
      ok: true,
      text: async () => FIXTURE_SHASUMS,
    });

    const result = await syncFlatpakElectron({
      manifestPath,
      packagePath,
      fetchFn,
      write: true,
    });

    expect(result.changed).toBe(true);
    expect(fs.readFileSync(manifestPath, 'utf8')).toContain('electron-v41.10.1-linux-x64.zip');
  });
});
