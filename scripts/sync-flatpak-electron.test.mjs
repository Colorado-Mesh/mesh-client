// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildElectronArchiveSourcesYaml,
  parseElectronSha256s,
  syncFlatpakElectronManifest,
} from './sync-flatpak-electron.mjs';

const FIXTURE_SHASUMS = `512f4e0574dc5800c612ea904e854f602f36ac57cade971a0a2b239bfaa19e52 *electron-v41.10.1-linux-x64.zip
2420f82a84ef47fd495b57f0b2b2f9a79edec7b2fed396600380ac006dadecef *electron-v41.10.1-linux-arm64.zip`;

const SAMPLE_MANIFEST = `      - type: file
        url: https://github.com/pnpm/pnpm/releases/download/v10.34.3/pnpm-linux-arm64
        sha256: ca4a85a4eb830713f1c37297d1a2b9fb9953719442bdb26daa8c64fadcc6c0b8
        dest-filename: pnpm-standalone
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

describe('sync-flatpak-electron.mjs', () => {
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
